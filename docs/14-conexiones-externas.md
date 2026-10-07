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
| `channel` | `channel_reply` | Agentes con al menos una conexión **activa** |

`mcpCaps(agent)` en `runtime.ts` calcula el conjunto en cada turno y los tres proveedores lo reciben (`TurnOptions.mcpCaps`). `channel_reply({ text })` responde **al hilo del mensaje que se está atendiendo**; el agente no copia ids. Si el turno no viene de un canal devuelve un error explicativo. Las instrucciones del agente (`composeInstructions`) añaden una sección que lo explica, con el nombre de la herramienta según el proveedor.

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
| `/new` | Solo administradores | Pide confirmación (`/new confirmar`) y reinicia la sesión compartida |

## 14.6 Telegram

Implementado con `fetch` plano contra la Bot API (sin dependencias nuevas), por **long polling**: no hace falta URL pública.

- **Arranque:** `getMe` valida el token. Si es inválido, la conexión se guarda con estado `error` y el motivo («Invalid bot token»).
- **Sondeo:** `getUpdates` con espera de 25 s; el *offset* se guarda en `connection_cursor` en cuanto se entrega cada actualización, así que un reinicio no repite mensajes. Los errores de red reintentan con espera creciente (hasta 30 s); un 409 (otro proceso sondea el mismo bot) espera 10 s.
- **A quién responde:** en chat privado, a todo mensaje de texto de un permitido. En grupos, solo si empieza con `/comando`, menciona `@bot` o responde a un mensaje del bot. Un comando dirigido a otro bot (`/x@otro_bot`) se ignora. Se ignoran mensajes de bots.
- **Hilos:** en un grupo con temas, la clave es `chat:tema` y la respuesta va al mismo tema (`message_thread_id`). En chat privado o grupo sin temas hay un solo hilo por chat.
- **Salida:** Markdown → HTML de Telegram (negrita, cursiva, código, bloques, enlaces); mensajes de más de 3500 caracteres se parten por párrafo, línea o palabra; si Telegram rechaza el HTML se reenvía como texto plano al mismo tema; separación mínima de 350 ms por chat y reintento con `retry_after` ante un 429.
- **Indicador de trabajo:** `sendChatAction: typing` cada 4,5 s mientras el turno corre.
- **Prueba:** el botón «Enviar prueba» comprueba el token y saluda a los usuarios permitidos.

## 14.7 Datos (SQLite, `connections/store.ts`)

| Tabla | Contenido |
|---|---|
| `connections` | tipo, nombre, agente vinculado (`ON DELETE SET NULL`), `config` (token y opciones, JSON), `allowed` (`[{ id, name, admin }]`), activa |
| `threads` | hilos conocidos: clave externa, título, destino de respuesta (JSON), último usuario y actividad. **Sin `session_id`** |
| `thread_messages` | lo recibido y enviado por hilo; única por `(hilo, dirección, id externo)` para desduplicar |
| `connection_cursor` | marca de agua del sondeo |

`config` opciones no secretas: `lang` (`es`/`en`, idioma de los avisos del bot), `on_silent`, `rate_limit`. La URL de la API (`api_base`) solo existe para pruebas.

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
| `POST /channel/reply` | Lo usa el MCP `hive` (`channel_reply`) |

**Los tokens nunca se devuelven:** en lugar del valor, la API envía `{ set: true, hint: "••••1234" }`. Los errores de validación (`400`) cubren: tipo desconocido, nombre repetido, token faltante, agente inexistente y agente en modo `plan`.

## 14.9 Interfaz

- **Conexiones** (`/connections`, en la barra lateral): tarjetas con nombre, estado (Conectada / Conectando / Problema / Apagada, con el motivo del error), agente, bot, nº de hilos y último mensaje. Se actualiza cada 5 s.
- **Panel de la conexión** (ampliable): plataforma, nombre, agente que responde (con aviso si está en solo lectura o en acceso total), token (se muestra `Déjalo vacío para conservar ••••1234`), personas permitidas (id, nombre, admin), idioma del bot, qué hacer si el agente no responde, activa/apagada, **Enviar prueba**, eliminar y la lista de hilos.
- **Chat del agente:** los mensajes de un canal se ven como burbuja con su origen; la llamada a `channel_reply` aparece como la fila **«Responder en el canal»** con el texto enviado (también cuando OpenCode la llama dentro de un bloque de código).

## 14.10 Pruebas

Scripts en `server/scripts/` (usan una carpeta de datos temporal y agentes reales):

| Script | Qué verifica |
|---|---|
| `sim-channel.ts <proveedor> [modelo] [permiso]` | Dos hilos contra una plataforma falsa: el agente responde con `channel_reply` al hilo correcto, recuerda lo dicho en el otro hilo, `/status` y la lista de permitidos. |
| `sim-telegram.ts [proveedor] [modelo]` | El adaptador de Telegram contra una Bot API falsa: token inválido, reglas de permisos, token oculto, chat privado, tema de un grupo, mensaje sin mención, comandos para otro bot, reinicio sin repetir, partido y formato, respaldo a texto plano. |
| `fake-telegram.ts [puerto]` | Bot API falsa para pruebas manuales de la interfaz (`POST /_say`, `GET /_sent`). |

## 14.11 Límites conocidos

- Solo texto: no se procesan adjuntos, imágenes ni voz.
- Una conexión se vincula a **un** agente (para hablar con varios, se vincula un orquestador).
- El adaptador de Slack no está implementado; la interfaz lo muestra como «pronto».
- No se ha probado contra la Bot API real (solo contra la simulación).
