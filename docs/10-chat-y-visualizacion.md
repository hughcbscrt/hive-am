# 10. Chat y formas de mostrar información

Este documento describe **qué se muestra** en la conversación con un agente, **de dónde sale** cada dato y **cómo se dibuja**. Archivos: `web/components/chat/Chat.tsx`, `ToolCall.tsx`, `StatsBar.tsx`, `web/components/agents/AgentSwitcher.tsx` y `web/lib/format.ts`.

## 10.1 Distribución de la pantalla del agente

`app/agents/[id]/page.tsx` organiza dos columnas dentro del área principal, y un panel de ajustes que **flota encima**:

```
┌ barra lateral ┬ selector de agentes ┬ chat ─────────────────────────────────────┐
│ (navegación)  │ AgentSwitcher       │ cabecera + StatsBar     ┌ ajustes (flota) ┤
│ 220 px        │ 290 px (o 68 px)    │ transcripción           │ Configuration   │
│               │                     │ caja de texto           │ Sessions        │
└───────────────┴─────────────────────┴─────────────────────────┴─────────────────┘
```

- El panel de **ajustes** está oculto por defecto; el botón **Settings** de la cabecera lo muestra (un punto indica cambios sin guardar). Su estado se recuerda en `localStorage` (`hive-cfg-open`).
- El panel es `position: fixed` a la derecha: **no encoge el chat**, se dibuja encima con sombra. Mide 400 px por defecto. El botón de ampliar (junto a *Hide*) lo lleva a la **mitad de la pantalla** y de vuelta; también se arrastra su borde izquierdo (o doble clic para alternar). Mínimo 340 px, máximo ancho de pantalla − 80 px. El ancho se recuerda en `localStorage` (`hive-cfg-width`).
- La página se monta con `key={id}`: al cambiar de agente desde el selector se reinicia todo el estado local (borrador, pestaña, sesión en lectura).

### Selector de agentes (`AgentSwitcher`)

Se puede **contraer** con el botón de su cabecera (icono de panel): pasa de 290 px a 68 px y deja solo el **avatar con la inicial** de cada agente, agrupados por colonia con una pequeña barra de color. Al pasar el mouse, el *tooltip* muestra el nombre y el proveedor; el agente actual sigue resaltado y los que trabajan conservan su punto pulsante. Cambiar de agente no lo expande y la elección se recuerda (`hive-switcher-collapsed` en `localStorage`).

Lista lateral agrupada por colonia (y "No colony"), con búsqueda. Cada agente muestra:

| Elemento | Origen |
|---|---|
| Avatar hexagonal con punto pulsante si trabaja (rojo si hay error) | `status` |
| Nombre y etiqueta *Orchestrator* | `name`, `role` |
| Subtítulo | Si está en un turno: **actividad en vivo** (p. ej. "Running Shell ls -la", "Thinking…", "Writing a reply…", con prefijo "Delegated task ·" si es una delegación). Si no: su descripción, "Needs attention" si hay error, o "No description yet". |
| Línea inferior | Proveedor · modelo, y "hace cuánto" (o "N queued") |

## 10.2 Cómo llega la información al chat

El chat combina **dos fuentes**:

| Fuente | Qué es | Cuándo se usa |
|---|---|---|
| **Historial nativo** (`GET /api/agents/:id/history`) | La transcripción guardada por el CLI, normalizada | Siempre: es la verdad. Se carga al abrir y se **vuelve a leer** al terminar cada turno |
| **Turno en vivo** (`LiveTurn` en el store) | Lo que llega por WebSocket durante el turno | Solo mientras el agente trabaja |

Al terminar el turno, el estado en vivo se descarta y el historial recién leído ya contiene los mismos mensajes. Si abres la página a mitad de un turno, el store reconstruye el turno con los eventos acumulados (`GET /live`).

### Eco optimista del mensaje del usuario

Al enviar, el texto se muestra de inmediato (`pending`). Se oculta cuando el historial ya contiene un mensaje de usuario con ese mismo texto. Si el envío falla, se quita el eco, se restaura el texto en la caja y se muestra un aviso.

### Cómo se pliega un evento en vivo (`foldEvent`, `lib/store.tsx`)

| Evento | Efecto sobre `LiveTurn.blocks` |
|---|---|
| `text` / `thinking` | Se añade al último bloque del mismo tipo, o se crea uno nuevo |
| `tool` | Nuevo bloque `tool` con `startedAt = ahora` |
| `tool_result` | Completa el bloque `tool` con ese `id` (`output`, `error`) y calcula `durationMs = ahora − startedAt` |
| `usage` | Se **acumula** en `LiveTurn.usage` (tokens se suman; `credits` y `contextPct` toman el último valor); también `cost` y `model` |
| `error` | Guarda `LiveTurn.error` |

## 10.3 Transcripción

### Mensajes del usuario

Burbuja oscura alineada a la derecha, con el texto tal cual (respeta saltos de línea).

### Respuestas del asistente

Encabezado con avatar, nombre y "hace cuánto", seguido de **bloques** en orden:

| Bloque | Cómo se muestra |
|---|---|
| `text` | Markdown (`react-markdown` + `remark-gfm`: tablas, listas, código, enlaces). No se permite HTML crudo. Cada bloque de texto está memoizado y solo se vuelve a procesar si cambia su texto |
| `thinking` | Fila plegable **"Thought process"** (en vivo y siendo el último bloque: "Thinking…") con el razonamiento en cursiva |
| `tool` | Fila de herramienta (ver 10.4) |
| *(resumen)* | Al final de la respuesta, **"Files changed (N)"** (ver 10.4) |

#### Agrupación de respuestas (`coalesce`)

Claude guarda una entrada por cada llamada a herramienta. Para que el usuario vea **una sola respuesta**, los mensajes consecutivos del asistente se **fusionan** en uno: se concatenan los bloques, se suman tokens y costo, se conserva el último modelo y la hora de fin. La duración mostrada es `fin del último mensaje − hora del mensaje del usuario` anterior.

#### Pie de cada respuesta (`ReplyMeta`)

Una línea discreta con (solo lo que exista):

- **Modelo** (sin el prefijo `claude-` ni el sufijo de fecha).
- **Tokens:** `X in · Y out`, donde *in* = entrada + lectura de caché + escritura de caché. El detalle exacto aparece en el *tooltip*.
- **Créditos** (Kiro).
- **Costo** con `≈` si es una estimación (tooltip: "Estimated from list prices" / "Reported by the CLI").
- **N tools** (número de herramientas usadas).
- **Duración.**

### Turno en vivo

Mientras el agente trabaja se muestra, tras el historial:

- Si es una **delegación**: tarjeta "Delegated task from *X*" con el texto de la tarea y una nota de que corre en su propia sesión.
- Si es un mensaje del usuario que aún no aparece en el historial: su burbuja.
- La respuesta parcial (mismos bloques), tres puntos animados "Working" y una línea `LiveMeta` con **tiempo transcurrido** (se actualiza cada 0,5 s), herramientas usadas, tokens acumulados y % de contexto si el CLI lo informa.
- Si ocurre un error: banner rojo con el mensaje y botón **Dismiss**.

## 10.4 Herramientas (`ToolCall.tsx`)

Cada llamada a herramienta es una fila plegable `<details>`:

```
[icono] Etiqueta  resumen (mono)            [exit 1] [N líneas] [duración] [●] ›
```

- **Etiqueta y resumen** vienen de `describe(tool)`, que reconoce los nombres de los tres proveedores.
- **Metadatos a la derecha:** código de salida (solo Shell, si el resultado contiene `Exit code N`; rojo si ≠ 0), "failed" si hay error sin código, número de líneas de salida, duración y, si está en curso, un punto pulsante.
- **En curso:** borde miel y cronómetro vivo.
- **Error:** borde rojo.

### Tabla de reconocimiento (`describe`)

El nombre se normaliza a minúsculas sin símbolos (p. ej. `str_replace` → `strreplace`). Para herramientas MCP (`mcp__servidor__herramienta`) se usa el nombre de la herramienta.

| Etiqueta | Nombres reconocidos | Resumen en la fila | Contenido al abrir |
|---|---|---|---|
| **Shell** | `bash`, `shell`, `executebash`, `execute`, `run`, `runcommand`, `command` (o cualquier herramienta con `command` cuyo nombre contenga `bash`) | **El comando completo**, con `$` en miel, hasta 3 líneas (1 al abrir) | Bloque terminal con el comando y botón **Copy command**; descripción del agente; nombre real de la herramienta, directorio de trabajo, *timeout*, *background* (si existen); salida con **Copy output** |
| **Read** | `read`, `fsread`, `view`, `cat` | Ruta completa (con `~` si está bajo tu carpeta personal) | Ruta, `offset`, `limit` |
| **Write** | `write`, `fswrite`, `create`, `writefile` | Ruta · N líneas | Ruta y contenido (máx. 4000 caracteres) |
| **Edit** | `edit`, `strreplace`, `strreplaceeditor`, `patch`, `replace` | Ruta | Ruta y **diff** (líneas viejas en rojo con `−`, nuevas en verde con `+`) |
| **Edit** (varios) | `multiedit` con `edits[]` | Ruta · N changes | Un diff por cada cambio |
| **Grep / Glob / Search…** | `grep`, `glob`, `search`, `find`, `ls`, `list`, `codesearch` | Patrón, consulta o ruta | Todos los parámetros |
| **Web** | `webfetch`, `websearch`, `fetch`, `browser` | URL o consulta | Todos los parámetros |
| **Subagent** | `task`, `agent`, `subagent` | Descripción o tipo | Tipo, descripción y prompt (máx. 1500 caracteres) |
| **Plan** | `todowrite` con `todos[]` | "N/M done" | Lista de tareas con estado (hecha tachada, en curso resaltada) |
| **Delegate** | `mcp__hive__dispatch` | `agente — tarea` | Subagente y tarea completa |
| **Team roster** | otras herramientas de `hive` (`list_agents`) | — | — |
| *Otras* | cualquier otra | Primer parámetro | JSON de los parámetros |

**Salida** (todas): sección *Output* con el texto devuelto, recortado a 12 000 caracteres (con aviso "(truncated)"); alto máximo con scroll; "(no output)" si está vacía.

### Archivos modificados (`ChangedFiles`)

Al final de cada respuesta (también en vivo, mientras el agente trabaja) se muestra un bloque plegable **Files changed (N)** con un renglón por archivo que el agente escribió o editó (`changedFiles()` en `ToolCall.tsx`). Está abierto si son 5 archivos o menos.

- Cuenta solo llamadas **sin error** de escritura (`write`, `fswrite`, `create`, `writefile`) y edición (`edit`, `strreplace`, `strreplaceeditor`, `patch`, `replace`, `multiedit`); varias ediciones del mismo archivo se suman en un renglón.
- Cada renglón muestra la ruta, la marca *written* si el agente escribió el archivo completo, y `+N` / `−N` líneas añadidas y quitadas.
- Cada archivo se **despliega** para ver sus cambios: un bloque rojo/verde por edición (lo quitado y lo añadido) o, si fue una escritura completa, el contenido (máx. 6000 caracteres).
- Los datos salen de los parámetros de la herramienta, no de `git diff`: pueden diferir de lo que muestre el [explorador de cambios](13-explorador-de-cambios-git.md) y no traen líneas de contexto ni números de línea.

### Expandir y contraer

Junto a la caja de texto, el enlace **Expand all tools / Collapse all tools** abre o cierra todas las filas a la vez (contexto `ToolsOpen`); cada fila puede abrirse o cerrarse por separado después.

## 10.5 Barra y panel de estadísticas (`StatsBar.tsx`)

Debajo de la cabecera, una franja con el resumen de la sesión mostrada (la actual, o la que estés leyendo). Se calcula en el servidor (`GET …/stats`, ver [documento 8](08-sesiones-e-historial.md#86-estadísticas-de-sesión-statsts)) y se vuelve a pedir al terminar cada turno. Mientras hay un turno en curso, se **suman** sus números en vivo.

| Indicador | Significado |
|---|---|
| **Contexto** | % de contexto informado por el CLI (Kiro); si no, se calcula `último contexto / 200 000` (valor fijo en `StatsBar.tsx`, `CTX_WINDOW`) |
| **tokens** | Entrada + salida + caché leída + caché escrita (formato `1.2k`, `45.3k`, `1.25M`) |
| **credits** | Créditos (Kiro), si los hay |
| **costo** | Total en USD con `≈` si es estimado |
| **turns** | Mensajes de usuario |
| **tool calls** | Llamadas a herramientas, con "· N failed" si hubo errores |
| **working** | Tiempo de trabajo acumulado (suma de turnos) |

Al hacer clic se despliega un panel con:

1. **Token mix:** barra apilada (caché leída, caché escrita, entrada, salida) y leyenda con cifras; los tokens de razonamiento se indican aparte. Debajo, la lista de **modelos** usados con mensajes y tokens de salida.
2. **Tools used:** hasta 9 herramientas con barra proporcional, veces, errores y tiempo promedio.
3. **Tokens per turn:** mini gráfica de los últimos 40 turnos; el *tooltip* muestra el prompt, tokens, costo, herramientas y duración.

## 10.6 Caja de texto (`Composer`)

- Es un componente **aislado y memoizado** que guarda su propio texto: escribir no vuelve a renderizar el historial (en una prueba con 12 mensajes se midieron ≈2 ms por tecla en modo desarrollo).
- **Enter** envía; **Shift+Enter** inserta salto de línea; no envía durante composición IME. Crece automáticamente hasta 200 px.
- Mientras el agente trabaja, el marcador cambia a "Queue a follow-up…": el mensaje se **encola** (ver [documento 9](09-orquestacion-y-relaciones.md#94-cola-por-agente)); aparece el botón **Stop**.
- Al leer una sesión que no es la actual, la caja se reemplaza por un aviso de solo lectura, y la cabecera ofrece "Make this conversation current" (solo sesiones directas) y "Back to current".
- Debajo se muestra "N queued" si hay mensajes en cola.

## 10.7 Comportamiento del scroll

La vista se mantiene anclada al final **mientras no te alejes**:

- Un `ResizeObserver` sobre el contenido vuelve a anclar al final cuando algo crece (markdown, herramientas, tablas).
- Girar la rueda hacia arriba **desancla**; volver a estar a menos de 40 px del final **reancla**; enviar un mensaje reancla.
- No se usa `scroll-behavior: smooth` (provocaba que no llegara al final).

## 10.8 Estado vacío y avisos

- Sin conversación: tarjeta "Say hello to *nombre*" con un texto distinto para orquestador (describir una meta) y worker (dar una tarea).
- Los avisos transitorios usan *toasts* (`useToast`): éxito en negro durante 3 s, error en rojo durante 6 s.
- Los errores de la API se muestran con el mensaje exacto del servidor.

## 10.9 Formato de números (`lib/format.ts`)

| Función | Reglas |
|---|---|
| `fmtTokens(n)` | `<1000` → entero; `≥1000` → `x.xxk`; `≥10 000` → `x.xk`; `≥1 000 000` → `x.xxM` |
| `fmtCost(c)` | `0` → `$0`; `<0.01` → `<$0.01`; `<1` → 3 decimales; resto 2 decimales |
| `fmtDur(ms)` | `<1 s` → `ms`; `<10 s` → 1 decimal; `<60 s` → segundos; luego `Xm Ys`; luego `Xh Ym` |
| `ago(ts)` (`lib/meta.ts`) | "just now", "N min ago", "N h ago", "N d ago", o fecha local |
