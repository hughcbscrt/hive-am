# 10. Chat y formas de mostrar información

Este documento describe **qué se muestra** en la conversación con un agente, **de dónde sale** cada dato y **cómo se dibuja**. Archivos: `web/components/chat/Chat.tsx`, `ToolCall.tsx`, `StatsBar.tsx`, `web/components/agents/AgentSwitcher.tsx` y `web/lib/format.ts`.

## 10.1 Distribución de la pantalla del agente

`app/agents/[id]/page.tsx` (dentro de `app/agents/layout.tsx`) organiza dos columnas dentro del área principal, y un panel de ajustes que **flota encima**:

```
┌ barra lateral ┬ selector de agentes ┬ chat ─────────────────────────────────────┐
│ (navegación)  │ AgentSwitcher       │ cabecera + StatsBar     ┌ ajustes (flota) ┤
│ 220 px        │ 290 px (o 68 px)    │ transcripción           │ Configuration   │
│               │                     │ caja de texto           │ Sessions        │
└───────────────┴─────────────────────┴─────────────────────────┴─────────────────┘
```

- El panel de **ajustes** está oculto por defecto; el botón **Settings** de la cabecera lo muestra (un punto indica cambios sin guardar). Su estado se recuerda en `localStorage` (`hive-cfg-open`).
- El panel es `position: fixed` a la derecha: **no encoge el chat**, se dibuja encima con sombra. Mide 400 px por defecto. El botón de ampliar (junto a *Hide*) lo lleva a la **mitad de la pantalla** y de vuelta; también se arrastra su borde izquierdo (o doble clic para alternar). Mínimo 340 px, máximo ancho de pantalla − 80 px. El ancho se recuerda en `localStorage` (`hive-cfg-width`).
- La columna del chat (`Workspace`) se monta con `key={id}`: al cambiar de agente desde el selector se reinicia todo su estado local (borrador, pestaña, sesión en lectura). El selector y la rejilla de dos columnas vienen de `app/agents/layout.tsx`, por encima del segmento `[id]` (la página misma se vuelve a montar con cada agente), así que el selector sigue montado y conserva su posición de scroll y el texto de búsqueda; al llegar (o recargar) se desplaza lo justo para mostrar el agente actual.

### Selector de agentes (`AgentSwitcher`)

Se puede **contraer** con el botón de su cabecera (icono de panel): pasa de 290 px a 68 px y deja solo el **avatar con la inicial** de cada agente, agrupados por colonia. Cada grupo empieza con un encabezado compacto, un `<button>` con `aria-expanded` que muestra una flecha, las iniciales de la colonia (las primeras letras de sus dos primeras palabras, o sus dos primeras letras) sobre una barra de su color y el contador; su `aria-label` y su *tooltip* llevan el nombre completo y el contador. Pliega el grupo igual que el encabezado de la lista completa y comparte lo guardado (`hive-am.switcher.folded`), con las mismas reglas: orquestadores primero, un grupo plegado conserva el agente actual y muestra un punto pulsante cuando alguno de sus agentes está en marcha, y todo grupo con coincidencias está abierto mientras la búsqueda tiene texto. Al pasar el mouse, el *tooltip* muestra el nombre y el proveedor; el agente actual sigue resaltado y los que trabajan conservan su punto pulsante. Cambiar de agente no lo expande y la elección se recuerda (`hive-switcher-collapsed` en `localStorage`).

Lista lateral agrupada por colonia (en el orden de las colonias y luego "Sin colonia"; los grupos vacíos se ocultan), con búsqueda. Dentro de cada grupo los orquestadores van primero y después el resto en el orden en que llegan. El encabezado de cada grupo es un `<button>` con `aria-expanded` que lo pliega; los grupos plegados se recuerdan (`hive-am.switcher.folded`, los ids de colonia y `free`; los ids de colonias borradas se descartan en el siguiente cambio). Un grupo plegado conserva la fila del agente actual y muestra un punto pulsante cuando alguno de sus agentes está en marcha. Mientras la búsqueda tiene texto, todo grupo con coincidencias está abierto, sin tocar lo guardado. Sin ningún agente, la lista dice "Aún no hay agentes". El modo contraído (avatares) pliega los mismos grupos. Cada agente muestra:

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

### Vista normal y compacta (`lib/chat/chatPrefs.ts`, `Pills.tsx`)

El selector **Normal / Compacto** (`.seg` con `aria-pressed`, en `.composer-meta` antes del enlace de expandir) fija una vista para todos los chats del navegador. Se guarda en `localStorage` con la clave `hive-am.chatView` (`'normal' | 'compact'`); un valor ausente o desconocido es `'normal'`. `useChatView()` lo lee con un store externo (`useSyncExternalStore`, instantánea de servidor `'normal'`), el mismo patrón que `lib/git/gitPrefs.ts`, así que no hay desajuste de hidratación. Lo leen `History` (que usa también la página **Sesiones**) y el turno en vivo.

- **Normal** pinta `Blocks` como antes.
- **Compacto** pinta cada respuesta con `PillReply` (`Chat.tsx`). `splitRuns` (`lib/chat/pills.ts`) parte los bloques en textos y tramos de pasos: el primer tramo va en la fila `.who` tras el nombre y la hora, los siguientes (pasos después de un texto) en su propia `.pillrow`. Cada paso es un `button.pill` con `aria-expanded`, `aria-controls` (si está abierto) y un `title` con el comando o la ruta completos; su detalle es un `.pill-detail` de ancho completo (`role="region"`) tras la fila, con el mismo `ToolDetail` que la tarjeta. Las etiquetas y tooltips salen de `describe()` (campos `pill` y `tip`).
- **Plegado**: toda respuesta del asistente salvo la última pinta primero una píldora resumen (`SummaryPill`, `summarize()`: pasos = razonamiento + herramientas, herramientas, la duración de la respuesta o, si falta, la suma de la de sus herramientas, sin las partes en cero) y esconde sus píldoras hasta que se pulsa. Mientras hay un turno en vivo (`History` recibe `live`), se pliegan todas las respuestas guardadas; el turno en vivo nunca se pliega. El estado de plegado y de apertura es local a cada respuesta.
- **Estados**: `err` si `tool.error` o un código de salida de shell distinto de 0 (`toolFailed`), con `salida N` / `falló` en rojo; un resumen que esconde un fallo recibe `err` y `N con error`. `running` conserva el borde miel, el contador de 500 ms (`useTick`) y el punto de ejecución.
- **Archivos modificados** es una píldora con los totales `+añadidas −quitadas` (`ChangedFiles compact`), cerrada por defecto y fuera del plegado.
- **Expandir todo / Contraer todo** (`ToolsOpen`) abre o cierra todas las píldoras (también las que llegan después) y despliega o pliega todos los resúmenes.
- Un clic en una píldora fuera del turno en vivo desancla la vista (ver 10.7), así que abrir un detalle más arriba no mueve lo que estás leyendo.

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

**Archivos e imágenes.** Pega una imagen o un archivo copiado con **Ctrl+V** (⌘V en Mac), suelta cualquier archivo sobre la caja o usa el botón del clip: cada uno aparece como vista previa (imágenes) o etiqueta (otros archivos) con una × (hasta 5 por mensaje, 20 MB cada uno; si el portapapeles también trae texto, se pega el texto). Al enviar, el servidor los guarda en el buzón del agente (la misma carpeta de los archivos que llegan por Telegram o Slack) y añade al mensaje una nota con sus rutas, para que el agente los abra con sus herramientas de archivos. Las imágenes se reconocen por sus bytes; cualquier otro archivo conserva su nombre (saneado) y nunca se ejecuta. La burbuja muestra las imágenes como miniaturas y los demás archivos como una etiqueta que descarga.

- Es un componente **aislado y memoizado** que guarda su propio texto: escribir no vuelve a renderizar el historial (en una prueba con 12 mensajes se midieron ≈2 ms por tecla en modo desarrollo).
- **Enter** envía; **Shift+Enter** inserta salto de línea; no envía durante composición IME. Crece automáticamente hasta 200 px.
- Mientras el agente trabaja, el marcador cambia a "Queue a follow-up…": el mensaje se **encola** (ver [documento 9](09-orquestacion-y-relaciones.md#94-cola-por-agente)); aparece el botón **Stop**.
- Al leer una sesión que no es la actual, la caja se reemplaza por un aviso de solo lectura, y la cabecera ofrece "Make this conversation current" (solo sesiones directas) y "Back to current".
- Debajo se muestra "N queued" si hay mensajes en cola.
- **Borrador por agente:** lo que has escrito y no enviado se guarda en el navegador (`hive-am.draft.<agentId>`), así que cambiar de agente o recargar no lo pierde; se borra al enviar.

## 10.7 Comportamiento del scroll

La vista se mantiene anclada al final **mientras no te alejes**:

- Un `ResizeObserver` sobre el contenido **y sobre el propio hilo** mantiene el final a la vista mientras está anclado: cuando algo crece (markdown, herramientas, tablas) y cuando el hilo se encoge (un borrador más alto, cambiar el tamaño de la ventana, el panel de terminal).
- Todo lo que te sube **desancla**, por poco que sea: la rueda, arrastrar con el dedo, desplazarte hacia arriba o las teclas RePág / Flecha arriba / Inicio. Solo cuenta si hay algo que desplazar. Estar a 2 px o menos del final **reancla**; enviar un mensaje reancla. La antigua tolerancia de 40 px ya no existe: el ajuste de la maquetación que sigue al final de un turno se distingue de un scroll de la persona por la ausencia de un gesto reciente (700 ms), no por la distancia.
- Mientras está desanclado **y** con al menos 8 px de contenido fuera de vista aparece sobre la conversación un botón **Ir al final**; salta al fondo y reancla. Una conversación sin nada que desplazar nunca lo muestra.
- La conversación es una región `role="log"` con etiqueta: los mensajes nuevos se anuncian con cortesía a los lectores de pantalla (no palabra por palabra mientras un turno se transmite).
- No se usa `scroll-behavior: smooth` (provocaba que no llegara al final).

## 10.8 Estado vacío y avisos

- Sin conversación: tarjeta "Say hello to *nombre*" con un texto distinto para orquestador (describir una meta) y worker (dar una tarea).
- Los avisos transitorios usan *toasts* (`useToast`): los errores en rojo se anuncian como alertas (`role="alert"`) y duran más (7 s más lo que mida el texto, hasta 15 s); los demás duran 3,5 s más lo que mida el texto, hasta 8 s. Tienen botón de cierre, se pausan mientras el puntero está encima o tienen el foco, un aviso idéntico no se repite y se muestran como máximo 5 a la vez.
- Los errores de la API se muestran con el mensaje exacto del servidor.

## 10.9 Formato de números (`lib/format.ts`)

| Función | Reglas |
|---|---|
| `fmtTokens(n)` | `<1000` → entero; `≥1000` → `x.xxk`; `≥10 000` → `x.xk`; `≥1 000 000` → `x.xxM` |
| `fmtCost(c)` | `0` → `$0`; `<0.01` → `<$0.01`; `<1` → 3 decimales; resto 2 decimales |
| `fmtDur(ms)` | `<1 s` → `ms`; `<10 s` → 1 decimal; `<60 s` → segundos; luego `Xm Ys`; luego `Xh Ym` |
| `ago(ts)` (`lib/meta.ts`) | "just now", "N min ago", "N h ago", "N d ago", o fecha local |
