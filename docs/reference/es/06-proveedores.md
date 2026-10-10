# 6. Manejo de proveedores

Un **proveedor** es un CLI de agente de código instalado en tu máquina. hive-am no usa SDKs ni ACP: ejecuta el CLI como proceso hijo, **un proceso por turno**, y lee su salida en formato JSON por líneas.

Hay exactamente tres proveedores (`Provider = 'claude' | 'opencode' | 'kiro'`), registrados en dos sitios:

- `server/src/providers/index.ts`: tabla `runners` (proveedor → función generadora).
- `server/src/api.ts`: tabla `PROVIDERS` (proveedor → binario y nombre para detección de instalación).

## 6.1 Contrato de un runner

```ts
type Runner = (o: TurnOptions) => AsyncGenerator<StreamEvent>;

interface TurnOptions {
  agent: Agent;               // agente YA resuelto (cwd, permisos, skills efectivos)
  prompt: string;             // mensaje del usuario o tarea delegada
  instructions: string;       // instrucciones compuestas (identidad + prompt + skills + equipo + canales + cuaderno)
  refreshInstructions?: boolean; // la sesión recibió instrucciones antiguas; reenviar
  mcpCaps: string[];          // capacidades del MCP `hive` que recibe: dispatch, channel, memory, skills (vacío: sin MCP)
  signal: AbortSignal;        // para detener el turno
}
```

Un runner debe: construir los argumentos, lanzar el CLI con `spawnLines`, y **traducir** cada línea a `StreamEvent` (ver [documento 5](05-comunicacion-back-front.md#eventos-de-un-turno-streamevent)). El runtime se encarga del resto (cola, estado, persistencia del puntero de sesión, WebSocket).

## 6.2 El lanzador común: `providers/spawn.ts`

`spawnLines({ cmd, args, cwd, env?, stdin?, signal })`:

- Lanza el proceso con `stdio: ['pipe','pipe','pipe']`, `cwd` = carpeta efectiva del agente y **`PWD` = esa misma carpeta**.
  > **Por qué `PWD`:** Node hereda `PWD` del servidor de hive-am; OpenCode confía en `PWD` por encima del `cwd` real y registraba las sesiones en la carpeta del servidor. Fijarlo explícitamente lo corrige para los tres proveedores.
- Entrega **stdout línea a línea** (`readline`), ignorando líneas vacías.
- `stdin`: si se da texto, lo escribe y cierra; si no, cierra el stdin de inmediato.
- Cancelación: al abortarse la señal envía `SIGTERM` al proceso.
- Termina con `exit` y no con `close`: algunos CLIs (OpenCode) lanzan un servicio en segundo plano que hereda el pipe de stdout y haría que `close` no ocurriera nunca. Tras `exit` espera 250 ms para vaciar el pipe y luego lo destruye.
- Si el proceso sale con código ≠ 0 y no fue cancelado, lanza un `Error` con el código y los últimos 600 caracteres de stderr. El runtime lo convierte en un evento `error`.
- `safeJson(línea)` parsea sin lanzar excepciones.

## 6.3 Claude Code (`providers/claude.ts`)

**Comando** (el prompt va por **stdin**, no como argumento):

```bash
claude -p --output-format stream-json --verbose --include-partial-messages \
       --permission-mode <permiso> \
       [--resume <session_id>] \
       [--model <modelo>] \
       [--append-system-prompt "<instrucciones>"] \
       [--mcp-config ~/.hive-am/mcp/<agentId>.json --allowedTools mcp__hive]
```

| Aspecto | Comportamiento |
|---|---|
| Permisos | `--permission-mode` recibe directamente `plan`, `acceptEdits` o `bypassPermissions`. En `acceptEdits` se añade `--disallowedTools` con `CLAUDE_EDIT_DENY` (`Edit(**/.git/**)`, `Edit(**/*.pem)`, `Edit(**/*.key)`); `.env` queda editable y escribir fuera de la carpeta ya lo bloquea el propio modo. Es el único proveedor que distingue «Editar archivos» de «Acceso total»: con el primero edita archivos pero un comando de shell que no sea de archivos (p. ej. `python3 …`) queda sin aprobar y falla; con el segundo corre todo. |
| Reanudación | `--resume <id>` si el agente tiene sesión. |
| Instrucciones | Se pasan en cada turno con `--append-system-prompt`, **pero Claude solo las aplica al crear la sesión**: con `--resume` conserva el system prompt original. Por eso, si cambiaron (skills, equipo, notas editadas…), la sesión reanudada recibe un bloque `<instructions update="true">` delante del mensaje, igual que OpenCode y Kiro; el historial lo oculta. |
| Delegación | Si es orquestador con subagentes: escribe el archivo MCP y añade `--mcp-config` y `--allowedTools mcp__hive` (permite todas las herramientas del servidor `hive` sin pedir confirmación). |
| Id de sesión | Se toma del primer evento que trae `session_id`. |

**Traducción de eventos**

| Línea de Claude | `StreamEvent` |
|---|---|
| `stream_event` → `content_block_delta` / `text_delta` | `text` |
| `stream_event` → `content_block_delta` / `thinking_delta` | `thinking` |
| `assistant` con bloque `tool_use` | `tool` |
| `assistant` con bloque `text` (solo si no hubo streaming de ese texto) | `text` |
| `user` con bloque `tool_result` | `tool_result` (`is_error` → `error`) |
| `result` | `usage` (tokens, `total_cost_usd`, `duration_ms`, primer modelo de `modelUsage`) y luego `done` (con `result` como `summary`) o `error` |

Si el proceso termina sin evento `result`, se emite un `done` simple.

## 6.4 OpenCode (`providers/opencode.ts`)

**Comando** (el prompt va como **último argumento**):

```bash
opencode run --standalone --format json --thinking --auto \
  [-s <session_id>] [-m <proveedor/modelo>] "<prompt (con preámbulo si aplica)>"
```

| Aspecto | Comportamiento |
|---|---|
| Permisos | Siempre `--auto` (aprueba lo que no esté denegado; un `deny` se respeta igual). Los tres niveles se escriben como reglas de OpenCode en `opencodePermissions()` (`providers/opencode.ts`): **solo leer** deniega `edit`, `bash` y `task`; **editar archivos** permite leer y editar (incluido `.env`) salvo `.git/**`, `*.pem` y `*.key`, deniega `bash` y `task`, y deniega `external_directory` (todo lo que quede fuera de la carpeta efectiva del agente, que es donde arranca el proceso) salvo `~/.hive-am/inbox/**`; **acceso total** no añade reglas. `doom_loop` queda por defecto. Ver [documento 12](12-operacion-y-problemas.md). |
| Modelo | `-m` con formato `proveedor/modelo`, p. ej. `opencode/…`. |
| Reanudación | `-s <id>` **solo si** la carpeta registrada por OpenCode para esa sesión (`session_v2.directory`) coincide con la carpeta del agente (o si no se puede saber). Si no coincide (sesiones creadas con versiones anteriores de hive-am que se registraron en la carpeta equivocada), se **inicia una sesión nueva**. |
| Instrucciones | Sin flag de system prompt: se envían como preámbulo en el mensaje (ver 6.6). |
| Configuración por turno | Siempre `--standalone` (servidor privado que sí lee la configuración del entorno) y la variable `OPENCODE_CONFIG_CONTENT` con `permission.question = "deny"` (y `edit`, `bash` y `task` si el agente es de solo lectura). Los turnos no son interactivos: la herramienta `question` de OpenCode se descartaba y el proceso terminaba con código 1 ("The user dismissed this question"). Denegada, el agente hace la pregunta como texto normal del chat. |
| Delegación | La misma variable `OPENCODE_CONFIG_CONTENT` añade el servidor MCP `hive` (solo orquestadores con subagentes). |
| Id de sesión | Campo `sessionID` de cualquier evento. |
| Servicio en segundo plano | Sin `--standalone`, `opencode run` usaría el servicio de OpenCode y no leería la configuración del entorno; con él cada turno levanta un servidor privado. El manejo de `exit` de 6.2 sigue aplicando. |
| Servidor persistente (`providers/opencode-server.ts`) | Los agentes **que responden un chat externo** (una conexión activa) no usan un servidor desechable: cada uno tiene su propio `opencode serve` (puerto y contraseña aleatorios, solo en 127.0.0.1) y el turno es `opencode run --server <url>`. El MCP de hive ya está conectado cuando llega el mensaje, así que la primera llamada a `tools.hive.*` ya no falla con `Unknown tool` (eso costaba un paso extra del modelo por turno) y desaparecen los ~4 s de arranque; las respuestas pasaron de 6–9 s a 2–4 s. El servidor lee la configuración del agente (permisos, MCP) solo al arrancar, así que un cambio en ella, o en la carpeta, lo reinicia. Para acotar la memoria (unos 150 MB en reposo y 300 MB tras un turno cada uno) se mantienen **2** como máximo (`HIVE_AM_OPENCODE_SERVERS` lo cambia; se detiene el menos usado recientemente) y cada uno se apaga tras 5 minutos sin turnos. Detener un turno también detiene su servidor. Los demás agentes (solo chat web, orquestadores, cuaderno) conservan el servidor desechable `--standalone`, igual que uno cuyo servidor no puede arrancar (se registra un aviso). Se detienen cuando hive-am se detiene (también con Ctrl+C o con el reinicio de un gestor de servicios); si hive-am muere de golpe (`kill -9`, un fallo), los que sobrevivan quedan anotados en `~/.hive-am/opencode-servers.json` y se detienen en el siguiente arranque. `HIVE_AM_OPENCODE_STANDALONE=1` desactiva la función. |

**Traducción de eventos**

OpenCode emite **partes completas**, no deltas:

| Línea de OpenCode (`part.type`) | `StreamEvent` |
|---|---|
| `text` / `reasoning` | `text` / `thinking`, calculando el *delta* como la parte nueva respecto a lo ya visto de esa misma parte (mapa por `part.id` y longitud) |
| `step-finish` | `usage` (`tokens.input/output/reasoning/cache.read/cache.write`, `cost`) |
| `tool` | `tool` la primera vez que aparece; `tool_result` cuando `state.status` es `completed` o `error` |

Al terminar el stream se emite `done`.

## 6.5 Kiro (`providers/kiro.ts`)

**Comando** (prompt como último argumento):

```bash
kiro-cli chat --no-interactive --output-format stream-json \
  [--agent hive-<id>] [--trust-all-tools] [--resume-id <session_id>] [--model <modelo>] "<prompt>"
```

| Aspecto | Comportamiento |
|---|---|
| Permisos | Una herramienta sin confianza no puede pedir aprobación (el turno no es interactivo) y falla. **Solo leer:** ninguna de confianza. **Editar archivos:** perfil generado (`~/.kiro/agents/hive-<id>.json`) con `allowedTools` = `fs_read`, `grep`, `glob`, `web_fetch`, `web_search` (`KIRO_EDIT_TOOLS`; el shell no) y `toolsSettings.fs_write`: `allowedPaths` = la carpeta efectiva del agente (con sus archivos que empiezan con punto, como `.env`) y `deniedPaths` = `.git`, `*.pem`, `*.key`. `fs_write` no se confía entero, así que una ruta fuera de la carpeta no se puede aprobar. **Acceso total:** `--trust-all-tools`. Dos cosas que aprendimos con Kiro 2.27: con un perfil (`--agent`) el flag `--trust-tools` deja de aplicarse, y las reglas `permissions.rules` de la documentación son de Kiro 3.x y aquí se ignoran; por eso se usa `toolsSettings`. |
| Reanudación | `--resume-id <id>`. Las sesiones de Kiro son por carpeta, de ahí la importancia del `cwd`. |
| Instrucciones | Preámbulo en el mensaje (ver 6.6). |
| Perfil | Kiro solo carga servidores MCP y rutas permitidas desde un perfil `~/.kiro/agents/hive-<agentId>.json`, que hive-am regenera en cada turno cuando el agente tiene herramientas de hive (`mcpServers.hive`, `tools: ["*"]`, `allowedTools: ["@hive"]`: delegación, canales, cuaderno, skills a demanda) o permiso «Editar archivos»; en ese caso se ejecuta con `--agent hive-<agentId>`. |
| Id de sesión | `data.sessionId` de cualquier evento. |

**Traducción de eventos** (Kiro emite eventos ACP en formato JSON por líneas):

| Línea de Kiro | `StreamEvent` |
|---|---|
| `metadata` con `meteringUsage` o `contextUsagePercentage` | `usage` (`credits`, `contextPct`, `durationMs`) |
| `sessionUpdate` → `agent_message_chunk` | `text` |
| `sessionUpdate` → `agent_thought_chunk` | `thinking` |
| `sessionUpdate` → `tool_call` | `tool` (nombre = `title` o `kind`) |
| `sessionUpdate` → `tool_call_update` con estado `completed`/`failed` | `tool_result` |
| `runFinished` con `status: success` | `done` (con `finalText`) |
| `runFinished` con otro estado | `error` |

## 6.6 Preámbulo de instrucciones (`providers/preamble.ts`)

OpenCode y Kiro no tienen un flag para añadir un system prompt, así que las instrucciones viajan **dentro del mensaje**:

| Situación | Qué se envía |
|---|---|
| Sesión nueva | `<instructions>…</instructions>` + el mensaje |
| Sesión reanudada y las instrucciones **cambiaron** (`refreshInstructions`) | `<instructions update="true">` (con aviso de que reemplaza a las anteriores) + el mensaje |
| Sesión reanudada sin cambios | Solo el mensaje |

¿Cómo sabe el runtime que cambiaron? Calcula un SHA‑1 de las instrucciones compuestas y lo compara con `agents.instr_hash` (la huella que recibió esa sesión). Esto evita, por ejemplo, que un orquestador conserve una lista de subagentes antigua tras conectarle nuevos.

Los lectores de historial **ocultan** estos bloques al mostrar el chat (ver [documento 8](08-sesiones-e-historial.md)). Los modelos sí los reciben.

## 6.7 Detección de instalación y modelos

**Instalación** (`GET /api/providers`): ejecuta `claude --version`, `opencode --version`, `kiro-cli --version` (máx. 8 s cada uno). Si fallan → `installed: false`. Resultado cacheado 60 s. La interfaz muestra "● installed" / "● not found" en el selector de proveedor.

**Modelos** (`server/src/models.ts`, caché 10 min, solo se cachean resultados no vacíos):

| Proveedor | Fuente |
|---|---|
| Claude | Lista fija: `opus`, `sonnet`, `haiku`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-4-5-20251001` |
| OpenCode | Salida de `opencode models` (se aceptan líneas con formato `proveedor/modelo`) |
| Kiro | `kiro-cli chat --list-models --format json` |

El campo de modelo de la interfaz es texto libre con sugerencias (`<datalist>`): si el CLI no lista modelos, puedes escribir cualquier id; vacío = modelo por defecto del CLI. Cambiar el proveedor de un agente limpia el modelo en el formulario.

## 6.8 Costos y precios

- Claude: `result.total_cost_usd` se emite como `usage.cost` en vivo; en el historial no hay costo, así que se **estima** con `pricing.ts`.
- OpenCode: usa el costo que reporta el CLI; si es 0, intenta estimar.
- Kiro: factura en **créditos**, no en tokens; se muestran créditos.

Tabla de estimación (USD por millón de tokens, por familia detectada en el nombre del modelo):

| Familia | Entrada | Salida | Lectura de caché | Escritura de caché |
|---|---|---|---|---|
| opus | 5 | 25 | 0.5 | 6.25 |
| sonnet | 3 | 15 | 0.3 | 3.75 |
| haiku | 1 | 5 | 0.1 | 1.25 |

Modelos fuera de esas familias no tienen costo estimado. Las estimaciones se marcan con "≈" en la interfaz.

## 6.9 Cómo añadir un proveedor nuevo

1. **Tipos:** añade el valor a `Provider` en `server/src/types.ts` y `web/lib/types.ts`.
2. **Runner:** crea `server/src/providers/<nombre>.ts` con un generador `(o: TurnOptions) => AsyncGenerator<StreamEvent>` usando `spawnLines`. Fija `cwd` y recuerda emitir `session` en cuanto conozcas el id.
3. **Registro:** añádelo a `runners` (`providers/index.ts`) y a `PROVIDERS` (`api.ts`).
4. **Historial:** crea un lector en `server/src/history/<nombre>.ts` que devuelva `ChatMessage[]` y enlázalo en `history/index.ts`.
5. **Modelos:** añade la rama en `models.ts`.
6. **Interfaz:** añade nombre, color y descripción en `web/lib/meta.ts` (`PROVIDERS`) y la variable de color `--p-<nombre>` en `globals.css` (claro y oscuro).
7. **Instrucciones:** si el CLI no tiene flag de system prompt, usa `withInstructions`; si sí lo tiene, pásalas en cada turno.
8. **Delegación (opcional):** si soporta MCP, añade en `mcp-config.ts` el objeto de configuración y pásalo cuando `o.mcpCaps` no esté vacío (el servidor anuncia solo las herramientas de esas capacidades).
