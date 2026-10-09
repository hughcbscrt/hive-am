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
- **OpenCode no traduce el permiso** (ver [documento 12](12-operacion-y-problemas.md)): ese agente puede editar y ejecutar aunque esté en solo lectura. La interfaz lo indica.
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

> **Sobre el token:** el token del bot está en `~/.hive-am/hive-am.db` y un agente con acceso a archivos del equipo podría leerlo. Las reglas (sección «Files» de `instructions.ts` y la descripción de `channel_send_file` en `server/mcp/dispatch.mjs`) y la herramienta evitan que lo necesite, pero no lo impiden: son instrucciones al modelo. Lo que el servidor sí hace cumplir es qué rutas pueden enviarse (`connections/outbound.ts`). Ver [7.6](07-agentes-tipos-skills-colonias.md#76-instrucciones-compuestas-composeinstructions). Si compartes el agente con personas en las que no confías del todo, usa permisos mínimos y rota el token con @BotFather si sospechas que se filtró.

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
| `fake-telegram.ts [puerto]` | Bot API falsa para pruebas manuales de la interfaz (`POST /_say`, `GET /_sent`). |

## 14.11 Límites conocidos

- El agente envía y recibe archivos, pero no transcribe audios ni analiza video.
- Una conexión se vincula a **un** agente (para hablar con varios, se vincula un orquestador).
- El adaptador de Slack no está implementado; la interfaz lo muestra como «pronto».
- Los chats privados se probaron contra la Bot API real; los **grupos, temas y el modo `open`** solo contra la simulación.
- Si un grupo se convierte en supergrupo cambia de id y hay que autorizarlo de nuevo.
- En modo `open` cada ráfaga de charla cuesta un turno del agente: úsalo con un modelo económico o en grupos pequeños.
