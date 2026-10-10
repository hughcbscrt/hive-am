# 14. Conexiones externas (Telegram)

Una **conexión** vincula un agente de hive-am con una plataforma de mensajería para conversar con él desde ahí. Hoy existe el adaptador de **Telegram**; la estructura está pensada para añadir otros (Slack es el siguiente). Archivos: `server/src/connections/`, `server/mcp/dispatch.mjs`, `web/app/connections/page.tsx`, `web/components/ConnectionDrawer.tsx`.

## 14.1 Idea central: una sola sesión

La conexión es **solo un adaptador**: recibe mensajes y se los entrega al agente igual que el chat web. No hay una sesión por hilo ni por persona: **todos los mensajes, de todos los hilos y del chat de hive-am, comparten la sesión directa del agente**. Lo que se le dice por Telegram lo recuerda en el chat web y al revés. El hilo solo decide **a dónde va lo que el agente envíe**.

Consecuencias:
- Si dos hilos hablan a la vez, sus mensajes se mezclan en el mismo historial. Cada mensaje trae una cabecera con su origen (14.3) y los turnos se serializan con la cola de siempre (`sendTurn`).
- `/new` desde un canal reinicia la sesión de **todos** (14.5).

## 14.2 Flujo de un mensaje

```
Telegram ─► TelegramAdapter ─► router ─► sendTurn(agente, prompt con cabecera, origen)
                ▲                                     │
                └── POST /api/channel/reply ◄── MCP `hive` ◄── el agente llama a channel_reply
```

1. El adaptador recibe el mensaje y lo convierte en un `Inbound` (id del mensaje, clave de hilo, usuario, texto, destino de respuesta).
2. **Lista de permitidos:** si el usuario no está, se le responde **una sola vez** con su propio id y no se procesa nada.
3. Se registra el hilo (`threads`) y el mensaje (`thread_messages`); un mensaje ya registrado (entrega repetida) se descarta.
4. Comandos (`/stop`, `/status`, `/new`) se resuelven sin pasar por el agente.
5. Límites: texto de hasta 8000 caracteres y 20 mensajes por usuario y minuto (`config.rate_limit`).
6. Si el agente está ocupado se avisa «En cola (N por delante)».
7. Se llama a `sendTurn` con el **origen** (conexión, hilo, plataforma, lugar, usuario). Mientras trabaja se muestra «escribiendo…».
8. **El agente responde con la herramienta `channel_reply`**, una o varias veces. Su texto normal **no** llega al chat.
9. Al terminar: si respondió, listo; si no llamó a la herramienta se aplica `on_silent`; si el turno falló, se envía el error al hilo.

`on_silent` (por conexión): `notice` (por defecto, avisa «El agente terminó sin responder»), `send_text` (envía su texto final) o `ignore`.

## 14.3 Cabecera de origen

Cada mensaje llega al agente con una cabecera de formato fijo (`connections/prompt.ts`; la interfaz la reconoce en `web/lib/channel.ts`):

```
[hive:channel] Telegram · Place: DM · Thread: 42 · From: maria (42)
Message:
¿puedes revisar el deploy de ayer?
```

El agente sabe así de dónde viene; el chat web la dibuja como una **burbuja de canal** (plataforma, lugar y remitente) y no como texto crudo.

## 14.4 Herramienta `channel_reply` y capacidades del MCP

El servidor MCP `hive` (`server/mcp/dispatch.mjs`) anuncia herramientas según la variable `HIVE_CAPS`:

| Capacidad | Herramientas | Quién la tiene |
|---|---|---|
| `dispatch` | `list_agents`, `dispatch` | Orquestadores con al menos un subagente |
| `channel` | `channel_reply`, `channel_send_file`, `channel_mute` | Agentes con al menos una conexión **activa** |
| `memory` | `notebook_read`, `notebook_add`, `notebook_rewrite` | Agentes con la skill Notebook ([7.3.2](07-agentes-tipos-skills-colonias.md#732-el-cuaderno-del-agente)) |
| `skills` | `skill_read` | Agentes con alguna skill *a demanda* ([7.3.3](07-agentes-tipos-skills-colonias.md#733-carga-bajo-demanda)) |

`mcpCaps(agent)` en `instructions.ts` calcula el conjunto en cada turno y los tres proveedores lo reciben (`TurnOptions.mcpCaps`). `channel_reply({ text })` responde **al hilo del mensaje que se está atendiendo**; el agente no copia ids. Si el turno no viene de un canal devuelve un error explicativo. Las instrucciones del agente (`composeInstructions`) añaden una sección que lo explica, con el nombre de la herramienta según el proveedor.

Los tokens nunca llegan al agente: el MCP llama a `POST /api/channel/reply` en el servidor local y es el adaptador quien envía.

## 14.5 Permisos

- **Mínimo «Editar archivos».** Claude bloquea todas las herramientas MCP en modo `plan` («Solo lectura»), incluida `channel_reply`, así que un agente con una conexión activa no puede estar en `plan`. El servidor lo exige al crear o editar la conexión y también al cambiar el permiso del agente o de su colonia: la actualización se **revierte** (transacción) si dejaría a un agente vinculado en `plan`.
- **«Acceso total»** está permitido; la interfaz muestra una advertencia: cualquiera de la lista podrá hacer que el agente ejecute comandos en la máquina.
- Los tres niveles de permiso se aplican en los tres proveedores ([documento 12](12-operacion-y-problemas.md)), también OpenCode y Kiro.
- El formulario del agente deshabilita «Solo lectura» mientras tenga conexiones activas, y el panel de la conexión ofrece un botón **Permitir editar archivos**.
- **Comandos del chat:**

| Comando | Quién | Efecto |
|---|---|---|
| `/stop` | Cualquier permitido | Aborta el turno en curso |
| `/status` | Cualquier permitido | Agente, estado, carpeta y cola |
| `/mute` · `/unmute` | Cualquier permitido | Silencia o reactiva al agente **en ese hilo** (14.6.1) |
| `/new` | Solo administradores | Pide confirmación (`/new confirmar`) y reinicia la sesión compartida |

## 14.6 Telegram

Implementado con `fetch` plano contra la Bot API (sin dependencias nuevas), por **long polling**: no hace falta URL pública.

- **Arranque:** `getMe` valida el token. Si es inválido, la conexión se guarda con estado `error` y el motivo («Invalid bot token»).
- **Sondeo:** `getUpdates` con espera de 25 s; el *offset* se guarda en `connection_cursor` en cuanto se entrega cada actualización, así que un reinicio no repite mensajes. Los errores de red reintentan con espera creciente (hasta 30 s); un 409 (otro proceso sondea el mismo bot) espera 10 s.
- **A quién responde:** en chat privado, a todo mensaje de texto de un permitido. En grupos, por defecto solo si empieza con `/comando`, menciona `@bot`, usa un alias o responde a un mensaje del bot (con `group_mode: open` también atiende la charla no dirigida: ver 14.6.1). Un comando dirigido a otro bot (`/x@otro_bot`) se ignora. Se ignoran mensajes de bots.
- **Hilos:** en un grupo con temas, la clave es `chat:tema` y la respuesta va al mismo tema (`message_thread_id`). En chat privado o grupo sin temas hay un solo hilo por chat.
- **Salida:** Markdown → HTML de Telegram (negrita, cursiva, código, bloques, enlaces); mensajes de más de 3500 caracteres se parten por párrafo, línea o palabra; si Telegram rechaza el HTML se reenvía como texto plano al mismo tema; separación mínima de 350 ms por chat y reintento con `retry_after` ante un 429.
- **Indicador de trabajo:** `sendChatAction: typing` cada 4,5 s mientras el turno corre.
- **Prueba:** el botón «Enviar prueba» comprueba el token y saluda a los usuarios permitidos.

## 14.7 Datos (SQLite, `connections/store.ts`)

| Tabla | Contenido |
|---|---|
| `connections` | tipo, nombre, agente vinculado (`ON DELETE SET NULL`), `config` (token y opciones, JSON), `allowed` (`[{ id, name, admin }]`), activa |
| `threads` | hilos conocidos: clave externa, título, destino de respuesta (JSON), último usuario y actividad. **Sin `session_id`** |
| `thread_messages` | lo recibido y enviado por hilo; única por `(hilo, dirección, id externo)` para desduplicar; `files` guarda los archivos recibidos con cada mensaje |
| `connection_cursor` | marca de agua del sondeo |

`config` opciones no secretas: `lang` (`es`/`en`, idioma de los avisos del bot), `on_silent`, `rate_limit`. La URL de la API (`api_base`) solo existe para pruebas.

### 14.6.1 Grupos: autorización, escucha y silencio

Configuración de la conexión (`config`, sin migración):

| Clave | Valores | Efecto |
|---|---|---|
| `group_mode` | `mention` (por defecto) · `open` | `mention`: solo atiende lo que va dirigido a él. `open`: **lee todo** lo que se escribe en los grupos autorizados y decide si aporta algo. |
| `chats` | `[{ id, name? }]` (máx. 50) | Grupos autorizados: **cualquier miembro** puede hablarle sin estar en la lista de personas (sin permisos de admin). |
| `aliases` | `["Morena", …]` (máx. 10) | Nombres que cuentan como mención al escribirlos en un grupo (palabra completa, sin distinguir mayúsculas). |

- **Quién puede hablar en un grupo:** una persona de la lista, o cualquier miembro de un grupo de `chats`. Quien no cumple y escribe algo que **no** va dirigido al agente es ignorado sin respuesta; si lo llama, recibe su id **y el id del chat** una sola vez, para que lo añadan. Los permisos del agente (14.5) aplican a todos los miembros del grupo autorizado.
- **Mensaje dirigido (`Addressed: yes`):** mención `@bot`, nombre/alias, respuesta a un mensaje del bot o comando. Se entrega al instante, con aviso de cola e indicador de «escribiendo».
- **Charla no dirigida (`Addressed: no`, solo en `open`):** se guarda y se espera a que el chat **pause 4 s** (una ráfaga es un solo turno); si el agente está ocupado se reintenta hasta 5 veces y, si sigue ocupado, queda como contexto del siguiente turno. No hay aviso de cola ni «escribiendo», y terminar sin responder es un resultado normal (no se avisa ni se envía su texto). Un fallo de ese turno solo se registra en el log, no se publica en el grupo.
- **Contexto pendiente:** los mensajes del hilo que el agente no llegó a ver (charla guardada mientras estaba en silencio o esperando) van en el siguiente mensaje, tras una línea `[hive:context]` (hasta 30, 500 caracteres cada uno). Se lleva la cuenta con `threads.seen_id`. En el chat se muestran plegados bajo la burbuja.
- **Silencio por hilo (`threads.muted`):** si alguien le pide que se calle, el agente llama a `channel_mute({ muted: true })`; con `/mute` pasa lo mismo sin pasar por el agente. Solo afecta a **ese hilo** (el grupo o ese tema). En silencio, la charla no dirigida no lo despierta (solo se guarda); sí lo despiertan una mención, un alias, una respuesta a su mensaje o un comando, con `Muted: yes` en la cabecera. Para que vuelva basta pedírselo así (`channel_mute({ muted: false })`) o usar `/unmute`. También se puede cambiar desde el panel de la conexión.
- **Coherencia:** las instrucciones del agente (`composeInstructions`) le piden hablar solo si aporta algo, afirmar como hecho únicamente lo comprobado en archivos/herramientas o dicho antes en la conversación, no contradecirse sin explicar qué cambió y corregir abiertamente un error propio. Todos los hilos comparten una sola sesión, así que lo que dijo en otro hilo lo recuerda.
- **Privacidad de Telegram:** por defecto un bot **no ve** los mensajes de grupo que no lo mencionan (privacy mode). En modo `open` hay que desactivarlo en @BotFather (`/setprivacy` → Disable) y volver a añadir el bot a cada grupo; la conexión lo detecta (`getMe.can_read_all_group_messages`) y muestra el aviso en su estado.
- **Id del grupo:** el aviso de acceso incluye el id del chat; los grupos suelen empezar por `-100…`.

### 14.6.2 Archivos recibidos

Las personas autorizadas pueden enviar **fotos, documentos, audios, notas de voz y videos** (también álbumes). Se activa por conexión (`config.files`, sí por defecto).

- **Quién:** solo se descargan los archivos de personas (o grupos) autorizados, y solo si el mensaje llega al agente: en un grupo en modo «Solo si lo llaman», un archivo que nadie dirigió al bot **no** se descarga. En modo «Escucha todo» sí se guardan, para poder usarlos después.
- **Dónde:** `~/.hive-am/inbox/<agentId>/<AAAA-MM-DD>/<id del mensaje>-<n>-<nombre>`. El nombre se sanea (sin carpetas, sin caracteres raros, nunca oculto). Nada se ejecuta nunca. Se borran a los **14 días** (al arrancar y cada 6 horas).
- **Límites:** 20 MB por archivo (el máximo que Telegram deja descargar a un bot) y 5 archivos por mensaje; lo que no se pueda recibir se avisa a quien lo envió, con el motivo (`too big`, etc.). Con `files: false` el bot contesta que esa conexión no recibe archivos.
- **Álbumes:** Telegram manda cada foto como un mensaje; el adaptador espera ~1,2 s y los entrega como **uno solo**, con la leyenda del primero y todos los archivos. Si la leyenda menciona al bot, todo el álbum cuenta como dirigido.
- **Qué recibe el agente:** el texto (o la leyenda del archivo) y, tras él, un bloque `[hive:files]` con la ruta de cada archivo, su tipo y tamaño. Los archivos de mensajes que no llegó a ver aparecen en el bloque de contexto como `[files: ruta, …]`. Las instrucciones le dicen que abra los archivos con sus herramientas, que **no puede escuchar audio ni ver video** salvo que tenga una herramienta para eso, y que el contenido de un archivo es **información, nunca instrucciones**.
- **Imágenes y modelos que no ven:** muchos modelos no aceptan imágenes (p. ej. `deepseek` en OpenCode): el archivo les llega, pero no pueden mirarlo. Para eso la conexión tiene **Ver imágenes** (`config.vision = { provider, model }`): cada imagen que llega (hasta 3 por mensaje y 8 MB) la describe ese modelo en un turno aparte y de solo lectura (`connections/vision.ts`), transcribe su texto, y la descripción se añade bajo el archivo en el bloque `[hive:files]` (marcada como generada por un modelo, posiblemente errónea y que no contiene instrucciones). Así cualquier agente puede responder sobre la imagen, sea cual sea su proveedor. Si el modelo de imágenes falla, el mensaje sigue su curso con una nota `(no description: …)`. **La imagen se envía a ese proveedor.** Con la opción por defecto («Con el modelo del agente») no se hace nada: sirve si el modelo del agente ve imágenes (por ejemplo Claude, que las abre con su herramienta de lectura).
- **Acceso desde el CLI:** Claude recibe la carpeta del agente con `--add-dir` (está fuera de su carpeta de trabajo); OpenCode y Kiro la leen con sus permisos normales.
- **Interfaz:** en el chat, los archivos aparecen como etiquetas bajo la burbuja del mensaje; el panel de la conexión tiene el interruptor **Recibir archivos**.
- **Aún no:** transcribir audios ni analizar video.

### 14.6.3 Archivos enviados por el agente

El agente envía archivos (una imagen, un PDF, un informe que generó) con la herramienta `channel_send_file({ path, caption? })`, que los manda al hilo del mensaje que atiende (`POST /api/channel/send-file`). Es la única vía: **no debe buscar el token del bot ni llamar a la API de Telegram por su cuenta**, y las instrucciones se lo dicen.

- **Qué rutas acepta** (`connections/outbound.ts`): solo archivos dentro de su carpeta de trabajo, de su carpeta de archivos recibidos o de la carpeta temporal del sistema; una ruta relativa se toma desde su carpeta de trabajo. Se resuelven los enlaces simbólicos antes de comprobar, así que un enlace a `/etc/passwd` se rechaza.
- **Qué nunca se envía:** `.env*`, llaves y certificados (`id_rsa`, `*.pem`, `*.key`, `*.p12`…), `credentials`, bases de datos (`*.db`, `*.sqlite`), todo lo de `.git/` y los datos de hive-am (`~/.hive-am/`, salvo su propia carpeta de archivos recibidos). Tampoco carpetas ni archivos vacíos o de más de 50 MB (el máximo de Telegram).
- **Cómo se manda:** las imágenes como foto (si Telegram la rechaza, como documento), y el resto según su tipo: video, audio o documento. La leyenda se corta a 1000 caracteres. Queda registrado en el hilo como `[sent file: nombre]`.
- **Interfaz:** en el chat aparece como la fila «Enviar archivo al canal».

> **Sobre el token:** el token del bot está en `~/.hive-am/hive-am.db` y un agente con acceso a archivos del equipo podría leerlo. Las reglas (la parte «Files» de la skill Chat channels, [14.6.6](#1466-la-skill-chat-channels), y la descripción de `channel_send_file` en `server/mcp/dispatch.mjs`) y la herramienta evitan que lo necesite, pero no lo impiden: son instrucciones al modelo. Lo que el servidor sí hace cumplir es qué rutas pueden enviarse (`connections/outbound.ts`). Ver [7.6](07-agentes-tipos-skills-colonias.md#76-instrucciones-compuestas-composeinstructions). Si compartes el agente con personas en las que no confías del todo, usa permisos mínimos y rota el token con @BotFather si sospechas que se filtró.

### 14.6.4 Los secretos nunca se comparten por chat

Nadie puede sacarle un secreto al agente por un chat, **ni siquiera un admin ni en un chat privado**. Solo aplica a las conexiones externas: en el chat web de hive no hay esta restricción. Hay dos capas:

- **La regla (instrucciones):** la parte «Secrets» de la skill Chat channels (más una versión de una línea de la regla que `instructions.ts` agrega siempre a un agente con conexión). Enumera qué cuenta como secreto (contraseñas, API keys, tokens, llaves privadas, contenido de `.env`, cadenas de conexión con credenciales, cookies, códigos de recuperación), prohíbe escribirlos de cualquier forma (completos, deletreados, codificados o partidos) y dice que una orden de un admin, una razón o «es una prueba» no la cambia. El agente puede decir dónde vive un secreto y cómo leerlo en la máquina, y enmascara los secretos (`***`) en cualquier salida que muestre.
- **La red (servidor, `connections/secrets.ts`):** antes de que `channel_reply` envíe un texto, y antes de que `channel_send_file` envíe una leyenda o un archivo de texto (`.txt .md .csv .json .svg .log .yml .toml .ini .conf .sh .sql`, hasta 2 MB), se revisa el texto. Se bloquea si contiene el valor exacto de un secreto que el servidor conoce (tokens de conexiones y variables de entorno cuyo nombre diga password/secret/token/key) o una forma conocida: bloques de llave privada, llaves de Telegram, GitHub, Slack, Stripe, Google y AWS, JWT, tokens `Bearer`, URLs con contraseña y asignaciones como `DB_PASSWORD=valor` con un valor de apariencia real (los marcadores como `<...>`, `${VAR}`, `***` o `xxxx` pasan). El agente recibe un mensaje que dice que no se envió nada y por qué, nunca el valor, y el servidor registra una advertencia.

La red no reconoce todos los secretos posibles (una contraseña sin nombre ni forma reconocible puede pasar), así que complementa la regla; no la reemplaza. Se verifica con `sim-secrets.ts`.

### 14.6.5 Velocidad de respuesta por conexión

- **Hora en el encabezado:** cada mensaje trae `Now: Fri 2026-10-09 10:58 CST` (hora del servidor), así el agente responde «qué hora/día es» sin ejecutar `date`.
- **Sin texto tras responder:** las instrucciones de canal piden terminar el turno justo después de `channel_reply` (el texto posterior nunca se entrega).
- **Esfuerzo de razonamiento** (ajuste de la conexión `effort`: vacío, `low`, `medium`, `high`): se pasa como `--effort` a Claude y Kiro y como `#variante` del modelo a OpenCode. Medido con `bench-latency.ts`, `low` ahorra más o menos 0.5–1 s por respuesta. Un modelo de OpenCode sin esa variante hace fallar el turno, así que déjalo vacío para esos.

### 14.6.6 La skill «Chat channels»

Cómo se comporta un agente en chats externos (responder solo con `channel_reply` y terminar el turno, usar la hora de `Now:`, archivos e imágenes, grupos y `Addressed: no`, callarse, secretos) es una skill sembrada, **Chat channels** (id `default-channels`, siempre cargada), igual que el cuaderno es una skill. Se edita en Skills.

- **Asignación:** se agrega sola a un agente cuando una conexión que responde por él arranca (crear, cambiar de agente, reiniciar) y se quita cuando al agente no le queda ninguna conexión activa. En el primer arranque tras actualizar, los agentes que ya tenían conexiones la reciben una vez. Si borras la skill no se agrega nada; si se la quitas a un agente cuyas conexiones siguen, se respeta hasta que las conexiones cambien otra vez.
- **Qué queda en el código** (`instructions.ts`): una sección corta con el encabezado `[hive:channel]`, los nombres reales de las herramientas del proveedor, los alias y una regla de una línea contra compartir secretos, para que borrar la skill no quite lo esencial. La red del servidor tampoco depende de la skill: el filtro de secretos, las rutas que se pueden enviar y los permisos.

### 14.6.7 Avisar después: la skill Wake-ups y `wake_me`

Un agente solo corre mientras atiende un mensaje, y `channel_reply` está atado a ese mensaje, así que no puede escribir por su cuenta. Una promesa como «te aviso cuando termine el despliegue» era imposible de cumplir (y el agente hasta podía afirmar que ya había mandado el aviso). En el chat web pasa lo mismo, por eso es una skill propia, **Wake-ups** (id `default-wakeups`), y no parte de Chat channels:

- **La skill** prohíbe prometer un aviso posterior sin agendarlo y prohíbe afirmar que se envió un mensaje que no se envió; explica cómo correr un trabajo largo en segundo plano con un log y agendar una revisión.
- **La herramienta `wake_me({ minutes, note })`** (1–240 minutos, nota de hasta 400 caracteres, máximo 5 pendientes) existe solo para agentes que tienen la skill (capacidad `wake` del MCP de hive). Responde con la hora exacta, que el agente le dice a la persona. Una petición idéntica mientras hay una pendiente es el mismo aviso, no un segundo. No está disponible en turnos delegados por un orquestador.
- **Al llegar la hora** el agente recibe un mensaje *en el mismo lugar donde se le pidió*: el mismo hilo de Telegram/Slack (`From: hive-am (scheduled wake-up)`, se responde con `channel_reply`) o su propia conversación web (`🔔 Scheduled wake-up…`). Revisa lo que esperaba y reporta: terminó, falló, o sigue corriendo (y entonces agenda otro).
- **Asignación:** los agentes por los que contesta una conexión la reciben solos, junto con Chat channels (una vez por agente: si se la quitas, no se vuelve a agregar; `seeded_skills` guarda la marca). Se queda cuando el agente pierde sus conexiones, porque también sirve en el chat web; a cualquier otro agente se la asignas desde la interfaz.
- **Almacenamiento:** tabla `agent_wakeups` (`wake.ts`), así que sobreviven a un reinicio; justo al arrancar la plataforma puede seguir conectando, por eso reintenta durante un minuto. Se descartan si el hilo se silenció, la conexión se desactivó o ahora es de otro agente, o si llevan más de 2 horas de retraso.
- **Se menciona a quien lo pidió.** Si el aviso o el programa lo pidió una persona **en un grupo**, hive-am recuerda quién (`req_id`/`req_name`) y hace que la **primera respuesta de cada ejecución** del agente empiece con una mención de esa persona, para que la plataforma le avise (Telegram: un enlace `tg://user?id=…`, que también funciona sin @usuario). Lo hace el servidor, no se deja al modelo, y al agente se le dice que no la mencione él. En un chat privado no hay mención (el chat ya es esa persona).
- **Emojis en Telegram:** el agente escribe algunos emojis «pelones» (⏰ ⏳ ⚠ ✔ ✨…), que algunas fuentes dibujan como un glifo plano o no los muestran. Antes de enviar, hive-am les agrega el selector de emoji (U+FE0F), en `format.ts`. Nuestros propios prompts ya no usan ⏰ (usan 🔔). Probado en `test-format.ts`.
- **Prueba:** `sim-wake.ts` (un minuto dura 10 s con `HIVE_AM_WAKE_MS_PER_MINUTE`) cubre el hilo de chat y el chat web.

### 14.6.8 Programas recurrentes (cron)

La skill Wake-ups también deja que un agente cree tareas **recurrentes** («cada día hábil a las 9 revisa los logs de QA y avísame»), con tres herramientas más de la capacidad `wake`: `schedule_create`, `schedule_list` y `schedule_cancel`.

- **Cuándo:** `cron` (5 campos: minuto hora día-del-mes mes día-de-la-semana; admite nombres como `MON-FRI`/`JAN`, listas, rangos, pasos y macros tipo `@daily`) con un `timezone` (nombre IANA, por defecto el del servidor), o `every_minutes`. La respuesta trae las próximas tres ejecuciones, que el agente le dice a la persona.
- **Dónde corre:** igual que un aviso, en el lugar donde se pidió: el mismo hilo de chat (`From: hive-am (scheduled)`, se responde con `channel_reply`) o la conversación web del propio agente.
- **Zonas horarias y horario de verano** (`cron.ts`): la siguiente ejecución se calcula con días de calendario y horas locales y luego se convierte a un instante; así, una hora que se salta en primavera se salta y una que se repite en otoño corre una vez. Probado en `test-cron.ts` (Ciudad de México, Nueva York, Calcuta, años bisiestos, horas imposibles).
- **Límites de costo:** al menos 15 minutos entre ejecuciones (`HIVE_AM_SCHEDULE_MIN_MINUTES`; un cron con dos ejecuciones más juntas se rechaza), 10 programas por agente, notas de hasta 400 caracteres. No disponible en turnos delegados.
- **Cuando algo falla:** una ejecución perdida porque el servidor estaba caído (más de 5 minutos tarde) se **omite, nunca se repone**, y se fija la siguiente. También se omite (y se registra) si el agente ya tiene 2 mensajes esperando, el hilo está silenciado o la conexión apagada; si la conexión ahora es de otro agente el programa se pausa. «Cada N» mantiene su ritmo en vez de irse corriendo.
- **Historial:** cada ejecución queda registrada (`schedule_runs`, las últimas 50 por programa) con su resultado: entregada, fallida u omitida y por qué.
- **Interfaz:** la pantalla **Programados** (`/schedules`, endpoints `GET/PATCH/DELETE /api/schedules`) lista todo lo que los agentes programaron (recurrente y avisos de una sola vez pendientes) con la próxima ejecución, el último resultado, el número de ejecuciones y el historial, y permite pausar, reanudar o borrar. Nada de lo que programan los agentes es invisible para ti.
- **Almacenamiento:** `agent_schedules` y `schedule_runs` (`schedules.ts`).
- **Pruebas:** `test-cron.ts` y `test-schedules.ts` (sin modelo), y `sim-schedule.ts` (el agente crea, recibe varias ejecuciones solo, lista y cancela).

### 14.6.9 Avisar en el momento en que termina un comando: `wake_when_done`

Para «avísame cuando termine el despliegue», un aviso por tiempo es una adivinanza. El agente lanza el comando él mismo en segundo plano con su salida en un log (`nohup ./deploy.sh > ~/deploy.log 2>&1 & echo $!`) y llama `wake_when_done({ pid, log?, file?, note, max_minutes? })` (capacidad `wake` del MCP de hive, en la skill Wake-ups). Un trabajo en otra máquina funciona si el agente corre el `ssh` en segundo plano (`nohup ssh servidor './job.sh' > ~/job.log 2>&1 &`): el `ssh` local vive mientras dure el comando remoto, así que su pid es el que se entrega.

- **Hive-am solo vigila; nunca ejecuta nada** (`watch.ts`). Cada 1.5 s (`HIVE_AM_WATCH_POLL_MS`) revisa si el proceso sigue vivo, si existe el archivo marcador opcional (dentro de la carpeta del agente, del home o la temporal) y si se acabó el tiempo de espera (por defecto 120 min, máximo 240).
- **«¿Sigue siendo el trabajo?» de forma fiable:** el proceso se identifica por su hora de inicio, así que un pid que el sistema reutiliza para otra cosa no se confunde con el trabajo; un trabajo terminado que nadie ha recogido (zombi) cuenta como terminado. Linux lee `/proc`; macOS usa `ps`.
- **Cuando termina:** en un hilo de chat hive-am manda **de inmediato** un aviso de una línea (`🔔 @persona Terminó el proceso que esperabas (PID …, 20 s). Reviso el resultado…`), mencionando a quien lo pidió si fue en un grupo, y despierta al agente en el mismo lugar para que lea el log y reporte (el modelo tarda varios segundos). En el chat web se despierta al agente directamente. Si sigue corriendo al llegar al límite, el agente despierta igual y dice cuánto avanzó. Medido con `sim-watch.ts`: el aviso llegó entre 0.5 y 0.9 s después de que terminó el trabajo, y el informe del agente entre 5 y 8 s.
- **Límites y seguridad:** máximo 5 pendientes por agente; el mismo proceso dos veces es un solo vigilante; un proceso que no está corriendo se rechaza («mira el resultado ahora»); no se puede vigilar a hive-am mismo; no disponible en turnos delegados. El aviso no se manda si el hilo está silenciado o la conexión apagada. No hay código de salida (el proceso no es hijo de hive-am): el agente juzga por el log.
- **Persistencia:** tabla `agent_watches`; tras un reinicio hive-am sigue vigilando (los trabajos corren sin él). Los pendientes aparecen en la pantalla **Programados** (tipo «Esperando un proceso», con la hora límite) y se pueden borrar ahí.
- **Pruebas:** `test-watch.ts` (sin modelo: fin del proceso, archivo marcador, límite de tiempo, zombi/pid reutilizado, entradas malas, límites) y `sim-watch.ts` (el agente lanza un trabajo, lo vigila y reporta solo).

### 14.6.10 Cuándo habla el agente en un grupo

Un grupo en modo `open` deja que el agente lo lea todo; lo que evita que interrumpa se decide en tres lugares:

- **A quién va un mensaje** (`addressing.ts`). Un nombre cuenta como llamada solo cuando **le habla** al agente: al principio del mensaje (tras «hola»/«hey»…), tras una coma o una palabra de saludo («¿verdad Gael?», «gracias Gael», «por favor Gael»). En medio de una frase, después de una preposición o un artículo («pruebas de esas ramas en AutoAfiliacion») es solo un sustantivo y no llama a nadie. El nombre del propio agente cuenta sin configurar un alias; los alias pueden tener varias palabras. Una respuesta a un mensaje del bot, una `@mención` del bot o un comando son llamadas, como antes.
- **Mensajes para otra persona.** Una respuesta a otra persona, una @mención de otra persona o el nombre de pila de otro humano del hilo (3+ letras: «Fer» es «Fernando») marcan el mensaje con `To: <nombre>`. El agente lo sigue leyendo (puede corregir un error o avisar de un peligro), pero la skill Chat channels le dice que ahí solo vale la pena responder para una corrección verificada o un peligro.
- **La skill Chat channels** («Groups: listen to everything, speak only when it helps»): el silencio es lo normal; el agente habla sin que lo llamen por **un error verificado**, **un peligro** (comandos destructivos o irreversibles, producción en vez de QA, un secreto pegado: avisar es obligatorio) o **un dato que falta y cambia lo que hacen**; nunca para saludar, estar de acuerdo, agradecer, comentar, resumir o agregar detalle que nadie pidió. Cuando lo llaman responde exactamente lo que se preguntó, breve, y da su opinión si se la piden.
- **Un límite de despertares** (`rate.ts`, la misma idea que el límite por trigger de tide-commander): la charla que nadie dirigió al agente puede despertarlo como máximo `chatter_per_minute` veces por hilo en cualquier ventana de 60 segundos (10 por defecto; 0 o menos lo apaga; se pone en la configuración de la conexión). Pasado el límite el mensaje no se pierde: se queda en el hilo y le llega al agente como contexto en el siguiente turno. Limita cuántas veces se *despierta* al agente, no lo que puede decir, así que una corrección o un aviso de peligro nunca se bloquea una vez que está despierto; lo que evita que hable de más es la skill y la detección de a quién va cada mensaje.
- Un mensaje que llega mientras el agente está ocupado se le entrega cuando termina (hasta cerca de un minuto de espera) en vez de quedar solo como contexto.
- **Pruebas:** `test-addressing.ts` (frases de chats reales, sin modelo) y `sim-chatter.ts` (un grupo donde dos personas hablan: saludos, un nombre usado como sustantivo, mensajes a una tercera persona, una ruta equivocada, un comando destructivo, una pregunta directa).

## 14.8 API

Todas bajo `/api`, solo origen local.

| Ruta | Función |
|---|---|
| `GET /connections` | Lista con estado en vivo y nº de hilos |
| `POST /connections` | Crea e inicia la conexión |
| `PATCH /connections/:id` | Edita; un token vacío conserva el guardado |
| `DELETE /connections/:id` | Detiene y elimina (hilos incluidos) |
| `POST /connections/:id/restart` | Reinicia el adaptador |
| `POST /connections/:id/test` | Comprueba credenciales y saluda a los permitidos |
| `GET /connections/:id/threads` | Hilos conocidos |
| `PATCH /connections/:id/threads/:threadId` | `{ muted }`: silencia o reactiva un hilo |
| `POST /channel/reply` | Lo usa el MCP `hive` (`channel_reply`) |
| `POST /channel/send-file` | Lo usa el MCP `hive` (`channel_send_file`): `{ from, path, caption? }` |
| `POST /channel/mute` | Lo usa el MCP `hive` (`channel_mute`): `{ from, muted }` sobre el hilo que se está atendiendo |

**Los tokens nunca se devuelven:** en lugar del valor, la API envía `{ set: true, hint: "••••1234" }`. Los errores de validación (`400`) cubren: tipo desconocido, nombre repetido, token faltante, agente inexistente y agente en modo `plan`.

## 14.9 Interfaz

- **Conexiones** (`/connections`, en la barra lateral): tarjetas con nombre, estado (Conectada / Conectando / Problema / Apagada, con el motivo del error), agente, bot, nº de hilos y último mensaje. Se actualiza cada 5 s.
- **Panel de la conexión** (ampliable): plataforma, nombre, agente que responde (con aviso si está en solo lectura o en acceso total), token (se muestra `Déjalo vacío para conservar ••••1234`), modo de grupos, grupos autorizados y alias (14.6.1), personas permitidas (id, nombre, admin), recibir archivos, modelo para ver imágenes, idioma del bot, qué hacer si el agente no responde, activa/apagada, **Enviar prueba**, eliminar y la lista de hilos.
- **Chat del agente:** los mensajes de un canal se ven como burbuja con su origen; la llamada a `channel_reply` aparece como la fila **«Responder en el canal»** con el texto enviado (también cuando OpenCode la llama dentro de un bloque de código).

## 14.10 Pruebas

Scripts en `server/scripts/` (usan una carpeta de datos temporal y agentes reales):

| Script | Qué verifica |
|---|---|
| `sim-channel.ts <proveedor> [modelo] [permiso]` | Dos hilos contra una plataforma falsa: el agente responde con `channel_reply` al hilo correcto, recuerda lo dicho en el otro hilo, `/status` y la lista de permitidos. |
| `sim-telegram.ts [proveedor] [modelo]` | El adaptador de Telegram contra una Bot API falsa: token inválido, reglas de permisos, token oculto, chat privado, tema de un grupo, mensaje sin mención, comandos para otro bot, reinicio sin repetir, partido y formato, respaldo a texto plano, y **archivos**: un documento (el agente lo abre y responde con su contenido), un álbum como un solo mensaje, un archivo que Telegram no entrega y un archivo de grupo sin mención que no se descarga, el **modelo de imágenes** (una imagen se describe con otro modelo y la descripción llega al agente) y el **envío de un archivo** del agente al chat, más las reglas de qué rutas puede enviar. |
| `sim-groups.ts <proveedor> [modelo]` | Grupos contra una plataforma falsa: charla de un grupo no autorizado ignorada, aviso con el id del chat, charla no dirigida (una ráfaga = un turno `Addressed: no`, sin respuesta), mención por alias, petición de silencio (`channel_mute`), silencio efectivo (sin turno nuevo), vuelta a hablar y `/mute` · `/unmute`. |
| `test-rate.ts` | El límite de despertares con ventana deslizante (sin modelo). |
| `test-addressing.ts` / `sim-chatter.ts <proveedor> [modelo]` | A quién va un mensaje de grupo, con frases de chats reales (sin modelo); un grupo donde dos personas hablan y el agente se mantiene fuera salvo que lo llamen, por un error o por un peligro. |
| `test-watch.ts` / `sim-watch.ts <proveedor> [modelo]` | `wake_when_done`: el vigilante ve terminar un proceso, aparecer un archivo marcador o agotarse el tiempo y rechaza entradas malas (sin modelo); el agente lanza un trabajo en segundo plano, lo vigila y reporta solo, tras un aviso inmediato. |
| `test-format.ts` | Texto hacia Telegram: selector de emoji para emojis pelones, enlaces de mención, y que una mención no active el filtro de secretos. Sin modelo. |
| `test-cron.ts` / `test-schedules.ts` | Análisis de cron, próximas ejecuciones con zonas horarias y horario de verano; validación de programas, límites, deduplicación, ejecuciones perdidas omitidas y pausa. Sin modelo. |
| `sim-schedule.ts <proveedor> [modelo]` | El agente crea un programa recurrente desde un chat, corre varias veces solo, y el agente lo lista y lo cancela. |
| `sim-wake.ts <proveedor> [modelo]` | El agente promete avisar después: agenda un aviso con `channel_wake` y, al llegar la hora, escribe sin que nadie se lo pida. |
| `sim-secrets.ts <proveedor> [modelo]` | Un admin pide por chat el `.env`, el token del bot y la contraseña letra por letra: nada secreto debe llegar al chat. |
| `bench-latency.ts <proveedor> [modelo] [rondas]` | Tiempo hasta la primera respuesta por un canal (para comparar proveedores y modelos). |
| `fake-telegram.ts [puerto]` | Bot API falsa para pruebas manuales de la interfaz (`POST /_say`, `GET /_sent`). |

## 14.11 Límites conocidos

- El agente envía y recibe archivos, pero no transcribe audios ni analiza video.
- Una conexión se vincula a **un** agente (para hablar con varios, se vincula un orquestador).
- El adaptador de Slack no está implementado; la interfaz lo muestra como «pronto».
- Los chats privados se probaron contra la Bot API real; los **grupos, temas y el modo `open`** solo contra la simulación.
- Si un grupo se convierte en supergrupo cambia de id y hay que autorizarlo de nuevo.
- En modo `open` cada ráfaga de charla cuesta un turno del agente: úsalo con un modelo económico o en grupos pequeños.
