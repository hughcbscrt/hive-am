# 11. Frontend

Next.js 15 (App Router) + React 19 + TypeScript. Casi todo es **componente de cliente** (`'use client'`): la interfaz depende de estado en vivo y del WebSocket, así que no se usa renderizado en servidor para datos.

## 11.1 Pantallas

### Inicio (`/`, `app/page.tsx`)

Todas las pantallas en un solo sitio. Solo lee el store (`useHiveData()`, que no vuelve a renderizar con cada token), los avisos sin leer (`useAttention()`) y el último chat (`hive-am.lastChat`): ninguna petición propia. Lo que muestra sale de `lib/homeModel.ts` (puro, probado por `server/scripts/test-web-home.ts`).

- **Cabecera:** un botón de búsqueda que abre la paleta de comandos (con `Ctrl K` / `⌘ K`) y un botón **Atajos de teclado** (con `?`) que abre `ShortcutsSheet`. Los dos llegan al Shell por el contexto `ShellCommands` (`lib/shellCommands.tsx`).
- **Ahora:** solo lo que vale más de cero, en este orden: agentes trabajando (a `/agents`), avisos sin leer (abre el panel Actividad), delegaciones `queued` o `running` (a `#recent`) y conexiones cuyo `status.state` es `error` (a `/connections`). Con todo a cero, una línea de calma.
- **Tarjetas:** tres grupos (`HOME_GROUPS` de `lib/sections.ts`): Trabajo (Chat, Agentes, Colonia, Relaciones), Operación (Recursos, Programados, Conexiones) y Biblioteca e historial (Tipos de agente, Skills, Sesiones). Cada tarjeta es un solo enlace con el icono de la pantalla (`components/sectionIcons.tsx`), el nombre, una descripción y un número cuando el cliente lo tiene: el nombre del último chat, totales, los agentes trabajando (o las colonias) en Colonia, y una línea roja con las conexiones en error. Relaciones, Programados y Sesiones no llevan número (el store no los tiene).
- **Estados:** diez esqueletos con `role="status"` mientras carga; con error, un aviso con *Reintentar* y las tarjetas sin números (siguen navegando); sin agentes, una tarjeta de bienvenida que abre `NewAgentDrawer`.
- **Delegaciones recientes:** el mismo feed que Colony (`components/RecentDelegations.tsx`).

### Colony (`/colony`, `app/colony/page.tsx`)

Mapa del enjambre y panel de detalle.

- **Cabecera:** el título con un icono de ayuda (**?**) que abre un popover con "cómo leer el mapa" (se cierra con Esc, clic fuera o el mismo icono), y un único menú **New** (agente, colonia, recurso).
- **Estadísticas:** agentes, recursos, orquestadores, trabajando ahora y tareas en curso; cada una es un **enlace** (a la lista de agentes, a la pantalla de recursos o al feed reciente).
- **Carga y errores:** un esqueleto mientras la API no ha respondido y, si falla, un aviso de error con botón *Reintentar* (nunca una colonia vacía).
- **Panal:** una celda hexagonal por agente, agrupadas por colonia (ver 11.2). Además de arrastrar, las colonias (por su nombre) y los hexágonos libres se pueden **mover con las flechas del teclado** (Mayús para pasos mayores).
- **Panel derecho:** al seleccionar una celda muestra descripción, proveedor, modelo, carpeta efectiva ("· from colony" si es heredada), sesión, equipo (orquestadores), un **selector de colonia** (mueve al agente), botón **Open chat** y, en la esquina superior derecha, el botón de **ajustes** que abre `AgentEditDrawer`.
- **Recent delegations:** las últimas 6, tomadas del store (`dispatches`, que refresca el WebSocket, sin sondeo), con enlaces al agente y a la sesión (`components/RecentDelegations.tsx`, compartido con Inicio).

### Agents (`/agents`)

Tabla con búsqueda (nombre, descripción, carpeta), filtros por rol y proveedor, y columnas: agente, proveedor · modelo, colonia, carpeta efectiva, estado y última actualización. La fila completa es clicable **y accesible con teclado** (Tab, luego Enter o Espacio), y la tabla se desplaza en horizontal en el móvil. La búsqueda y los filtros de rol y proveedor se recuerdan en el navegador (`hive-am.agents.q`, `.role`, `.provider`). Estados vacíos distintos para "sin agentes" y "sin resultados".

### Agente (`/agents/<id>`)

Selector de agentes + chat + ajustes plegables (ver [documento 10](10-chat-y-visualizacion.md)). La cabecera es un `WorkspaceHeader`. El panel de ajustes y su pestaña viven en la URL (`?tab=config|notebook|sessions`), así que un enlace los abre; en pantallas de más de 1100 px el panel abierto reserva su ancho en el chat (ya no lo tapa) y su ancho se arrastra y se recuerda. En la cabecera, el control **Chat / Cambios** alterna entre la conversación y el [explorador de cambios de git](13-explorador-de-cambios-git.md). El panel de ajustes tiene dos pestañas:

- **Configuration:** `AgentForm` completo con barra inferior *Save changes* / *Discard* y botón *Delete agent* (con confirmación).
- **Sessions:** conversaciones y tareas delegadas.

Cabecera: volver a Colony (`/colony`), avatar, nombre, rol, proveedor, modelo, estado, **New conversation** (con confirmación) y **Settings**.

### Connections (`/connections`)
Tarjetas de las conexiones externas con su estado en vivo (se refresca cada 5 s) y un panel lateral para crearlas o editarlas (cerrarlo con cambios sin guardar pregunta antes). Detalle en el [documento 14](14-conexiones-externas.md).

### Types (`/types`)

Tarjetas de tipos (rol, proveedor, modelo, nº de skills, nº de agentes que lo usan) con **Edit** (panel lateral) y **Create agent**. El editor incluye selector de proveedor, modelo, permisos, prompt (monoespaciado, con contador de caracteres) y skills.

### Skills (`/skills`)

Lista a la izquierda (búsqueda y uso `N agents · M types`) y editor a la derecha (nombre, descripción, instrucciones con pestañas *Write/Preview*). Botón *Delete* con confirmación que indica a cuántos agentes/tipos afecta. Cambiar de skill, o salir, con cambios sin guardar pide confirmación; un borrado fallido muestra un aviso de error.

### Relations (`/relations`)

Lienzo de React Flow; ver [documento 9](09-orquestacion-y-relaciones.md#lienzo-relations-apprelationspagetsx).

### Sessions (`/sessions`)

Lista por día con búsqueda y filtro por proveedor, y panel de transcripción con enlace **Open agent**. La sesión elegida está en la URL (`?session=<id>`). La transcripción usa los bloques del propio chat (`History`), así que **se ven las llamadas a herramientas y el razonamiento** y los mensajes largos ya no se pliegan.

Connections, Types, Skills, Relations y Sessions no están en el menú: se llega desde Inicio y la paleta, y cada una muestra un enlace `‹ Inicio` encima de su título (`components/HomeCrumb.tsx`, `.crumb`), también vacía o con error. En Relations la cabecera flota sobre el lienzo con `pointer-events: none`, así que el enlace pone `pointer-events: auto`.

## 11.2 El panal (mapa de Colony)

Implementado en `app/colony/page.tsx`, sin librerías de gráficos: celdas HTML posicionadas de forma absoluta y capas SVG.

**Geometría.** Hexágonos de punta arriba con radio `S = 74`; ancho `W = √3·S`, alto `H = 2·S`. Las posiciones salen de **coordenadas axiales** recorridas en espiral (anillo 0, 1, 2…), con `x = W·(q + r/2)` e `y = 1.5·S·r`.

**Agrupación.**

1. Se crea un *cluster* por colonia y uno extra "No colony" para los agentes sin colonia (se omite si está vacío y ya hay agentes).
2. Dentro de cada cluster el orden es: orquestadores primero (centro), luego los workers que ellos conectan (`orderMembers`), luego el resto. Así las conexiones directas quedan cerca.
3. A cada cluster se le añade una **celda fantasma** "Add agent" (crea el agente ya dentro de esa colonia). Una colonia vacía muestra solo esa celda.
4. Los clusters se acomodan por filas (*shelf packing*) con ancho máximo de fila 880 px, separación 36 px, margen interior 26 px y 50 px arriba para la etiqueta.

**Contorno de la colonia (solo rodea los hexágonos).** Para cada cluster se dibujan los polígonos de sus hexágonos **dos veces** en un SVG bajo las celdas: primero con un trazo ancho del color de la colonia y uniones redondeadas, luego encima con un trazo algo menos ancho del color de fondo teñido. Lo que sobresale es un anillo continuo que sigue el borde exterior de la unión; no hace falta calcular la unión geométrica.

**Celdas.** Botones con `clip-path` hexagonal. Borde del color del proveedor; las celdas de orquestador usan el color miel. Un punto pulsante indica trabajo; rojo si hay error. Etiqueta con nombre y proveedor, y una pastilla `↑ nombre` / `↓ N` que indica la relación.

**Relaciones.** SVG por encima de las celdas (ver [documento 9](09-orquestacion-y-relaciones.md#pantalla-colony-appcolonypagetsx)).

**Ajuste a la pantalla.** Un `ResizeObserver` mide el panel y escala el mapa completo con `transform: scale(k)` (`k ≤ 1`, nunca amplía) para que quepa sin scroll horizontal.

**Mover cosas y zoom.** Una colonia se arrastra por la etiqueta con su nombre, y un agente o recurso sin colonia por su hexágono (un arrastre se distingue de un clic por un umbral de 6 px); la posición se guarda en este navegador (`localStorage`, `hive-colony-layout`) como píxeles absolutos del lienzo, y un botón devuelve todo a su lugar. El mapa tiene **zoom** (botones − / +, Ctrl/⌘ + rueda, 40–250 %, guardado en `hive-colony-zoom`) sobre la escala de ajuste a la pantalla; con zoom el panel se desplaza.

**Hover/selección.** El estado `focus = hover ?? seleccionado` decide qué celdas y líneas se resaltan o se atenúan (`dim`, `linked`).

## 11.3 Estado global (`lib/store.tsx`)

Un solo contexto React (`useHive()`), sin librerías de estado. Contiene los datos (agentes, tipos, skills, colonias, proveedores), el estado de conexión, los turnos en vivo y el contador `finished`. Guarda también `dispatches` (el registro de delegaciones, que se recarga cuando el WebSocket avisa de cambios) y el estado de carga: `ready` es `true` solo cuando la API ha respondido, `error` lleva el mensaje y `retry()` lo intenta de nuevo. Expone `refresh([...])`, `agent(id)`, `clearLive(id)` y `onTurnEnd(listener)`: el oyente se llama fuera de React cada vez que termina un turno en vivo (un evento `status` a `idle` o `error` de un agente con turno vivo, la misma condición que sube `finished`), con el origen, el resultado y un extracto leídos antes de que el reductor descarte el turno. `clearLive` despacha su `status` con `silent: true`, así que quitar el banner de error no es un fin de turno. Por rendimiento hay hooks estrechos (`useHiveSelector`, `useHiveData`, `useLive`, `useFinished`, `useAgent`, `useHiveActions`); `useHive()` conserva su forma de siempre. El WebSocket es `wss:` si la página es https. Detalle del WebSocket en el [documento 5](05-comunicacion-back-front.md#56-estado-en-el-navegador-libstoretsx).

Hooks de utilidad en `web/lib/hooks/`:

| Hook | Qué hace |
|---|---|
| `usePolling(fn, ms, opts)` | Llamada periódica que nunca se solapa, se pausa con la pestaña oculta, aumenta la espera ante errores y avisa una vez por racha |
| `usePersistentState(key, initial)` | Estado guardado como JSON en `localStorage` (seguro si el almacenamiento está bloqueado; el primer render usa el valor por defecto) |
| `useQueryState(key, initial)` | Estado en la URL (`?tab=`) con `history.replaceState`: sin recarga y sin entradas de historial |
| `useUnsavedGuard(dirty)` | Avisa antes de cerrar o recargar la pestaña con cambios sin guardar. Dentro de la app, los paneles preguntan con un `ConfirmDialog` antes de descartarlos (sin `window.confirm` nativo) |
| `useResizableWidth({ key, min, default, max, side })` | El ancho al que se arrastra un cajón o panel, recordado en `localStorage` (lo usan `Drawer` y el panel de ajustes del agente) |

`lib/api.ts` lanza `ApiError` (con `status`), acepta `{ signal, timeoutMs }` en cada llamada y ofrece `isAbort(e)`. `lib/format.ts` tiene `fmtTime`, `fmtDate` y `fmtDateTime`, que usan el idioma de la app y no el del navegador.

### Avisos sin leer (`lib/attention.tsx`, `lib/attentionRules.ts`)

`AttentionProvider` (dentro de `HiveProvider`, en `Shell`) escucha `onTurnEnd` y guarda un aviso por agente, `{ kind: 'done' | 'error', at, snippet }`, en `localStorage` con la clave `hive-am.unread` (sincronizado entre pestañas con el evento `storage`). Omite el agente en pantalla (ruta `/agents/<id>` con la pestaña visible) y los turnos delegados que terminaron bien; borra el aviso del agente en pantalla; cuando `ready` es `true` poda los agentes borrados, los avisos de más de 7 días y deja 100. `snippet` es el error, o el último bloque de texto, en una línea y recortado a 140 puntos de código; se queda en este navegador hasta que el aviso se lee (**Marcar todo como leído** vacía la clave). También pone el título de la pestaña (`(N) hive-am`, que un `MutationObserver` restituye si Next lo cambia), anuncia los avisos nuevos en una región `aria-live` educada (`.sr-only`, como mucho un mensaje cada 2 s) y, si `hive-am.notify` es `true` y el navegador lo permite, muestra una `Notification` (tag = id del agente, sin sonido) con la pestaña oculta o sin foco. Lee el store solo con selectores estrechos, nunca `live`. `useAttention()` da `unread`, `latest`, `markRead`, `markAll`, el estado de las notificaciones y `announce`; `useActivityPanel()` abre y cierra el panel **Actividad** (`components/ActivityPanel.tsx`, primer elemento del pie del rail, que es `sticky` abajo del rail). Las reglas puras (`turnEnd`, `shouldRecord`, `pruneUnread`, `badgeOf`, `tabTitle`, `dotState`, `statusLine`) las prueba `server/scripts/test-web-attention.ts`. El punto de un avatar (`StatePip`) es honey y pulsa mientras trabaja, rojo con estado de error o aviso de error, verde con un aviso `done` de un agente libre, y lleva su estado como nombre accesible.

`lib/types.ts` **replica a mano** los tipos del backend (`server/src/types.ts`). No hay paquete compartido: si cambias un tipo de la API, actualiza ambos.

## 11.4 Componentes compartidos

| Componente | Función |
|---|---|
| `Hex` | Avatar hexagonal con iniciales; color del proveedor, o miel si es orquestador; tamaños `sm`, normal, `lg` |
| `ProviderBadge`, `StatusChip`, `RoleChip` | Etiquetas pequeñas de proveedor, estado y rol |
| `Dialog` / `Modal` / `Drawer` | Un solo mecanismo de capas (`Dialog.tsx`): se dibujan en un portal, el resto de la página queda `inert` mientras hay uno abierto, hay una **pila global** (solo el de arriba atiende Esc, así que un modal sobre un cajón ya no cierra los dos), el foco queda atrapado dentro y se devuelve a lo que lo abrió al cerrar, y se bloquea el desplazamiento de la página. El foco inicial va al elemento con `data-autofocus` (si no, al primer control que no sea el de cerrar); un elemento que debe seguir activo bajo un diálogo lleva `data-live`. `Modal` tiene botón de cerrar. El `Drawer` es **ampliable**: botón de ampliar en su cabecera (560 px ↔ 1100 px), borde izquierdo arrastrable (mín. 420 px, máx. pantalla − 80 px) y doble clic para alternar; el ancho se recuerda (`hive-am.drawerWidth`, con `useResizableWidth`) y lo comparten todos los paneles |
| `ConfirmDialog` | Confirmación (`danger` pone el foco inicial en Cancelar): maneja el estado de ocupado y, si la acción falla, muestra un aviso de error y no se cierra |
| `Tabs` / `TabPanel` | Pestañas con roles ARIA, tabindex itinerante y teclas Izquierda/Derecha/Inicio/Fin; el mismo `idPrefix` va en ambos |
| `EmptyState`, `Banner`, `SearchInput`, `CheckRow` | El estado vacío (con `className`), el aviso (con un botón `action` opcional, p. ej. *Reintentar*), el cuadro de búsqueda (con `ref`, `autoFocus` y `onKeyDown`) y la fila con casilla (`compact` para listas densas) |
| `WorkspaceHeader` | Cabecera de las pantallas de agente y de recurso: enlace de vuelta, avatar, título, una acción primaria y secundarias que **colapsan en el `Menu`** cuando la propia cabecera mide menos de 760 px |
| `useCombobox` (`combobox.ts`) | Ids, `aria-activedescendant` y `aria-controls` para listas desplegables (`SkillPicker`, `PickSearch`, `Suggest`) |
| `MasterDetail` (`objects/`) | La maqueta lista y detalle que comparten las pantallas de recursos |
| `objects/db/` y `objects/http/` | Las pantallas de recursos de base de datos y HTTP divididas por responsabilidad: `DbWorkspace.tsx` conserva el estado y las pestañas y monta `QueryPane`, `Results`, `SchemaPane`, `HistoryPane` y `NameModal` (helpers SQL puros en `dbSql.ts`); `HttpWorkspace.tsx` es una carcasa fina sobre el hook `useHttpWorkspace` (todo el estado, efectos y acciones) y los componentes de presentación `HttpRequestList`, `HttpResponseView`, `HttpResponseTabs`, `HttpFileView`, `HttpHistoryPane` y `HttpSessionBlock` |
| `MemberPick` (`agents/`) | Selector de miembros que usa el editor de colonias |
| `Field`, `Segmented` | Campo con etiqueta, ayuda y error (la etiqueta queda ligada a su `input`, `select`, `textarea` o `PasswordInput` con `useId`); control segmentado |
| `ProviderPicker` | Tres tarjetas con indicador de instalado |
| `ModelField` | Texto libre con sugerencias del proveedor |
| `PermissionField` | Control segmentado con la explicación del permiso elegido |
| `SkillPicker` | Lista de skills con casillas (`.skillrow` + `.check`), se reutiliza para miembros de colonia y equipos |
| `SkillPicker` (modo y peso) | Cada skill elegida es una pill con su botón `siempre` / `a demanda` (se elige por agente, tipo o colonia); bajo el selector se suma lo que va siempre en el prompt |
| `NotebookPanel` | Pestaña **Cuaderno** de los ajustes del agente: edita su memoria (ver 7.3.2) |
| `FolderPicker` | Campo de ruta + explorador de carpetas (usa `GET /api/fs/dirs`) |
| `Toaster` / `useToast` | Avisos transitorios: los errores se anuncian (`role="alert"`), cierre manual, pausa al pasar el puntero o con foco, los avisos idénticos no se repiten, máximo 5 |
| `PathPicker` | Selector de carpeta o archivo; muestra la carga y, si `GET /api/fs/dirs` falla, el error con un botón *Reintentar* |
| `AgentForm` | Formulario único de agente (incluye herencia y *Team*); la pantalla de tipos lo usa con `mode="type"` |
| `ColonyEditor` | Editor de colonias + diálogo de herencia |
| `NewAgentDrawer`, `AgentEditDrawer` | Crear y editar agentes en panel lateral |

## 11.5 Estilos y tema (`app/globals.css`)

Un solo archivo CSS, organizado por secciones comentadas (shell, primitivas, hex, colony, tabla, espacio de trabajo, chat, herramientas, estadísticas, colonias, lienzo, selector…).

### Tokens de diseño

Definidos en `:root` y redefinidos para el tema oscuro (un solo bloque oscuro, `:root[data-theme='dark']`):

| Grupo | Variables |
|---|---|
| Superficies | `--bg`, `--bg-deep`, `--surface`, `--surface-2` |
| Texto | `--ink`, `--ink-2`, `--muted` |
| Líneas | `--line`, `--line-strong` |
| Acento | `--honey`, `--honey-ink`, `--honey-soft` (miel: orquestadores y acciones primarias) |
| Estado | `--ok`, `--err`, `--err-soft`, `--err-ink` (texto de error), `--danger` (alias de `--err`) |
| Colores por significado | `--cluster` (clusters), `--link-manager` (enlaces de gestor), `--series-mix` (cuánto se mezclan con el fondo las series de los gráficos en oscuro) |
| Capas | `--z-1` … `--z-6`, `--z-drop`, `--z-pop`, `--z-side`, `--z-menu`, `--z-dock`, `--z-card`, `--z-fullscreen`, `--z-dialog`, `--z-toast`, `--z-tooltip`: no hay números de `z-index` sueltos en el CSS |
| Tamaño de letra | `--fs-micro` (11), `--fs-caption` (11,5), `--fs-small` (12), `--fs-hint` (12,5), `--fs-ui` (13), `--fs-ui-lg` (13,5), `--fs-body` (14), `--fs-lead` (15) |
| Proveedores | `--p-claude`, `--p-opencode`, `--p-kiro` |
| Forma | `--radius`, `--radius-sm`, `--shadow` |
| Tipografía | `--font-display` (Bricolage Grotesque), `--font-body` (Hanken Grotesk), `--font-mono` (JetBrains Mono) |

### Tema claro/oscuro

- Atributo `data-theme` en `<html>`: `light` o `dark`. Un script en línea de `layout.tsx` lo fija (y `lang`) **antes del primer pintado** a partir de `localStorage` o, sin elección guardada, de `prefers-color-scheme` (que sigue observando), así una página oscura nunca parpadea en claro.
- El botón **Switch theme** (pie de la barra lateral, con `aria-pressed`) alterna y guarda la elección en `localStorage` (`hive-theme`).
- Encima, el menú muestra la versión (`v1.7.0`) a la derecha del estado de conexión, en la misma fila (`.conn.ver`; el estado dice solo *Conectado*, la frase completa va en el tooltip y en el texto para lectores de pantalla). `web/next.config.mjs` la lee de `web/package.json` (que `make release` sube junto con las demás) y la fija al compilar como `NEXT_PUBLIC_HIVE_AM_VERSION`; sin versión no muestra nada. Oculta con el menú plegado y por debajo de 760px.
- El contraste de `--muted` y `--ok` se subió para cumplir 4,5:1 en texto en el tema claro.
- Las iniciales de los hexágonos son oscuras en tema oscuro para mantener el contraste.

### Tipografía

Las fuentes se cargan con `next/font/google` en `layout.tsx`, por lo que **la primera compilación necesita red**; sin ella se usan las fuentes del sistema (hay `fallback` en las variables).

### Responsivo y accesibilidad

- Puntos de corte: **1100 px** (las columnas se apilan) y **760 px** (la barra lateral pasa a barra superior).
- La barra lateral (`Shell.tsx`, `.rail`) tiene seis entradas: Inicio, Chat, Colonia, Recursos, Agentes y Programados. Las pantallas, sus rutas, las palabras clave de la paleta y cuáles están en el menú viven en `lib/sections.ts` (`MENU_IDS`, `MORE_IDS`), probado por `test-web-home.ts`. El logo enlaza a Inicio, una línea bajo las entradas (`.rail-hint`, solo desplegada) dice dónde quedaron las otras cinco, un icono de teclado junto al selector de idioma abre `ShortcutsSheet` y el lema se oculta en ventanas de 800 px de alto o menos.
- La barra lateral se pliega de 220 px a 64 px con el botón de su cabecera (`aria-expanded`, `aria-label` *Contraer el menú* / *Expandir el menú*). El ancho es `--rail-w` en `.shell`; plegada, cada entrada conserva su etiqueta como `aria-label` (con el contador) y `title` (lo muestra el tooltip global), los contadores pasan a insignias (`99+` por encima de 99) y EN/ES se apilan. El estado se guarda en `localStorage` (`hive-am.railCollapsed`) y el script en línea de `layout.tsx` lo aplica como `data-rail` en `<html>` antes del primer pintado, así que al recargar nunca parpadea la barra ancha; el ancho solo se anima tras un clic (`.rail-anim`). Por debajo de 760 px el plegado se ignora y el botón se oculta.
- Foco visible en todos los controles (`:focus-visible`), `aria-label` en botones de solo icono, `aria-pressed`/`aria-current`/`aria-selected` en controles de estado, `role="dialog"` en paneles y diálogos.
- `prefers-reduced-motion` desactiva animaciones y transiciones.
- Atajos globales (`lib/hotkeys.ts`, reglas en `lib/hotkeyRules.ts`, probadas por `server/scripts/test-web-hotkeys.ts`): un solo `keydown` en `window` en fase de burbuja (el Ctrl+` de `lib/dock.tsx` sigue en captura). `Mod` es Ctrl, o ⌘ en Mac (solo `metaKey`; se detecta tras montar). **Mod K** abre o cierra la paleta de comandos (`components/CommandPalette.tsx`, un `Dialog` con `useCombobox`; lo que lista es `lib/paletteRules.ts`, probado por `test-web-palette.ts`: con la consulta vacía, *Más secciones* con las cinco pantallas fuera del menú va antes de los 5 primeros agentes; con texto, hasta 50 agentes y todas las pantallas, por su etiqueta o por las palabras clave en inglés y español de `lib/sections.ts`, y la fila muestra la palabra que casó), **Mod B** pliega el rail, **Mod .** abre el aviso sin leer más reciente (sin avisos dice `attn.noUnread` en la región `aria-live`) y **?** abre `ShortcutsSheet` (también el icono de teclado del rail, el botón de Inicio y la acción de la paleta; el Shell guarda ese estado y lo comparte por `ShellCommands`). Se ignoran siempre con `isComposing`, `repeat`, `altKey` o `defaultPrevented`; los Mod funcionan en campos de texto normales pero no dentro de `[data-hotkeys="own"]` (xterm, `MarkdownEditor`, `CodeEditor`, `SourceEditor`, `SqlEditor`, el panel de consultas de bases de datos), ni con una capa abierta (`dialogDepth() > 0`) salvo Mod K si la capa es la paleta; **?** se ignora en campos, comboboxes, zonas `own`, con una capa o un `[role="menu"]` abierto; `/` queda para el explorador git. Marca con `data-hotkeys="own"` cualquier editor nuevo que tenga teclas propias. `lib/theme.ts` (`flipTheme`) y `chatHref()` de `lib/lastChat.ts` los comparten el rail y la paleta.
- Los diálogos atrapan y devuelven el foco; las pestañas, el árbol de archivos y las listas se manejan con teclado; el chat es un `role="log"`; las filas de tabla que abren algo son enfocables.
- Unas clases de utilidad sustituyen estilos en línea repetidos: `.cluster` (fila que se ajusta), `.stack-s`, `.stack-l`, `.gap-xs`, `.gap-m`, `.push-r`, `.ellipsis` y `.mt-*`, además de las anteriores `.row`, `.col`, `.grow`, `.gap-s`, `.gap-l`.

### Convención y una lección aprendida

Los selectores son **globales**: un nombre de clase genérico puede chocar con otro componente. Se han corregido cuatro casos:

| Choque | Síntoma | Solución |
|---|---|---|
| `.shell` (layout de la app) usada también como modificador de la fila de Shell | La fila de herramienta Shell se volvía enorme y vacía | Renombrado a `.is-shell` |
| `.empty` (estado vacío) usada como modificador del subtítulo del selector | Las filas del selector se deformaban | Renombrado a `.blank` |
| `.name-cell span` (descripción) alcanzaba también al avatar `<span class="hex">` | Iniciales grises ilegibles en la tabla de agentes | Acotado a `.name-cell > div > span` |
| `.split` (diseño de dos paneles de Skills/Tipos, con `display: grid`) usada como modificador de la tabla de diffs | La vista "lado a lado" del explorador quedaba de 340 px | Renombrado a `.is-split` (y `.empty` → `.void`) |

**Regla práctica:** antes de añadir una clase modificadora, busca (`grep`) que el nombre no exista ya en `globals.css`; y acota los selectores de descendientes (`>`) cuando contengan componentes reutilizables.

## 11.6 Rendimiento

- El historial del chat está memoizado (`History`), cada bloque markdown también (`Md`, `Blocks`), y la caja de texto guarda su propio estado.
- Los componentes que solo necesitan datos (chat, navegación, colonia) leen los hooks estrechos del store, así que el estado `live` en streaming no los vuelve a renderizar con cada token.
- El mapa se calcula con `useMemo` a partir de agentes y colonias.
- El lienzo de relaciones usa su propio estado de nodos y solo recalcula el layout cuando cambian los agentes.

## 11.7 Datos que la interfaz espera

Resumen de lo que cada pantalla necesita del backend, para quien toque la API:

| Pantalla | Endpoints |
|---|---|
| Todas | `GET /api/agents`, `/types`, `/skills`, `/colonies`, `/providers`, WebSocket |
| Inicio | `GET /api/dispatches` (a través del store, nada propio) |
| Colony | `GET /api/dispatches`; `PATCH /api/agents/:id` (mover de colonia); `POST/PATCH/DELETE /api/colonies` |
| Agente | `GET …/history`, `…/stats`, `…/live`, `…/sessions`; `POST …/messages`, `…/stop`, `…/new-session`, `…/resume-session`; `PATCH/DELETE /api/agents/:id` |
| Types | `POST/PATCH/DELETE /api/types` |
| Skills | `GET /api/skills/usage`; `POST/PATCH/DELETE /api/skills` |
| Cuaderno | `GET/PUT /api/agents/:id/notebook` |
| Relations | `PUT /api/orchestrators/:id/workers` |
| Sessions | `GET /api/sessions`; `GET /api/agents/:id/history?session=` |
| Formularios | `GET /api/providers/:p/models`; `GET /api/fs/dirs` |

## 11.8 Internacionalización (i18n)

Toda la interfaz está disponible en **inglés** y **español**. El sistema es propio y pequeño (sin librerías) y vive en `web/lib/i18n/`.

### Selector de idioma

- Está **arriba de la barra lateral**, debajo del logo (`/icon.png`, el mismo del favicon; se oculta cuando la barra se colapsa): un control `EN | ES` (`LanguageSwitch` en `components/Shell.tsx`), con el icono de atajos de teclado a su derecha.
- El cambio es **inmediato** y no recarga la página.
- **Nada del idioma aparece en la URL**: las rutas (`/agents`, `/relations`, …) son las mismas en ambos idiomas. La elección se guarda solo en `localStorage` (`hive-locale`).
- Idioma inicial: el guardado en `localStorage`; si no hay, el del navegador (`es*` → español, cualquier otro → inglés). También se actualiza `<html lang>`.
- Como las pantallas son de cliente, en la primera carga se ve un instante el texto base en inglés antes de aplicarse el idioma guardado.

### Piezas

| Archivo | Función |
|---|---|
| `en.ts` | Catálogo plano `{ 'clave.con.puntos': 'Texto' }`. **Es la fuente de todas las claves**: de ahí salen los tipos `DictKey` y `MessageKey`. |
| `es.ts` | `Record<DictKey, string>`: si falta una clave que existe en `en.ts` (o sobra una), **`tsc` falla**. |
| `core.ts` | `translate(clave, params?)`, `getLocale()`, `detectLocale()`, `intlLocale()` (etiqueta para `Intl`/`toLocale*`) y `translateServerError()`. Guarda el idioma actual en una variable de módulo. |
| `index.tsx` | `I18nProvider` (estado, persistencia, `<html lang>`) y el hook `useI18n()` → `{ t, locale, setLocale }`. |

### Cómo se usa

```tsx
const { t } = useI18n();
t('nav.agents')                              // "Agents" / "Agentes"
t('newAgent.created', { name: a.name })      // "{name} created" → "x creado"
t('chat.tools', { count: 3 })                // plural: "3 tools" / "3 herramientas"
```

- **Parámetros:** `{nombre}` en el texto se reemplaza por `params.nombre`.
- **Plurales:** si `params.count` es un número, se usa `clave_one` o `clave_other` según `Intl.PluralRules`; ambas deben existir en los dos catálogos. Si el texto debe mostrar el número con separadores, se pasa además un parámetro ya formateado (p. ej. `n: fmtNum(...)`).
- **Claves dinámicas:** se permiten cuando todas las variantes existen (`t(\`role.${rol}\`)`, `t(\`status.${estado}\`)`, `permission.<id>.label`, `provider.<id>.blurb`).
- **Fuera de componentes** (utilidades como `ago()`, `describe()` de herramientas, validaciones): se usa `translate` de `lib/i18n/core` en el momento de renderizar; el componente que las llama usa `useI18n()` para volver a renderizarse al cambiar de idioma. Los componentes memoizados que muestran texto traducido llaman a `useI18n()` (los consumidores de contexto se actualizan aunque estén en `memo`).
- **Fechas:** `intlLocale()` da `es-MX` / `en-US` para `toLocaleDateString`.

### Errores del servidor

El backend responde en inglés. `lib/api.ts` pasa cada mensaje por `translateServerError()`, que lo reconoce con una tabla de expresiones regulares (nombres y rutas se conservan como parámetros) y devuelve el texto traducido. Los mensajes **no reconocidos** (por ejemplo, el *stderr* de un CLI) se muestran tal cual. Los mensajes del propio turno (`turn.error`) pasan por la misma función.

### Qué **no** se traduce

- Nombres de marca: Claude Code, OpenCode, Kiro.
- Contenido creado por el usuario o por el seed: nombres y descripciones de agentes, tipos, skills y colonias.
- Lo que dicen los modelos y la salida de las herramientas.
- Las **instrucciones que reciben los agentes** (identidad, equipo, delegación): son texto para el modelo y se mantienen en inglés (`server/src/instructions.ts`).
- Los nombres de herramientas "crudos" que no tienen etiqueta propia (Grep, Glob, WebFetch…), que se muestran como los reporta el CLI.
- El `<title>` y la descripción del documento (`app/layout.tsx`), fijos en `hive-am`.

### Añadir o cambiar un texto

1. Escribe la clave y su texto en **`en.ts`** y su traducción en **`es.ts`** (misma clave, mismos `{parámetros}`).
2. Úsala con `t('…')`. No escribas texto visible directamente en JSX, atributos (`placeholder`, `aria-label`, `title`), avisos (`toast`) ni mensajes de validación.
3. Ejecuta `npm run typecheck`: detecta claves inexistentes y diferencias entre catálogos.

Convención de claves: `<área>.<elemento>`, por ejemplo `agent.sessions.empty`, `colony.err.name`, `tool.k.path`. Textos compartidos viven en `common.*`, `role.*`, `status.*` y `permission.*`.

### Añadir un idioma

1. Crea `web/lib/i18n/<codigo>.ts` con `Record<DictKey, string>`.
2. Añade el código a `Locale` y a `LOCALES` en `core.ts`, y el diccionario a `dicts`; ajusta `intlLocale()` y `detectLocale()`.
3. Los plurales usan `Intl.PluralRules`: si el idioma tiene más formas que `one`/`other`, amplía `translate()`.

### Nota de desarrollo

Con `next dev`, al editar los catálogos el recargado en caliente reinicia el módulo `core.ts`; `I18nProvider` vuelve a sincronizar el idioma en cada render para que la interfaz no quede en un idioma distinto al del selector.

## Tarjeta de información del agente (hover)

Al pasar el mouse (o enfocar con el teclado) sobre un agente en la **lista lateral** (expandida o contraída) o en una celda del **mapa de la colonia**, aparece una tarjeta con su información: nombre, rol y estado, descripción, actividad actual, proveedor y modelo, permisos efectivos, carpeta, colonia, equipo (orquestador) o quién lo dirige (worker), sesión y última actualización.

- `web/components/agents/AgentCard.tsx`: hook `useAgentCard()` (devuelve `bind(id)` y `node`) y la tarjeta, renderizada con `createPortal` en `<body>` y posicionada a la derecha del elemento (a la izquierda si no cabe).
- Se abre con ~280 ms de retraso (sin retraso al pasar de un agente a otro), se cierra con `Esc`, scroll, redimensionar, clic o al salir. Ignora el puntero y no se muestra en pantallas < 760 px.
- `web/lib/activity.ts`: `activity()` (antes dentro de `AgentSwitcher`), compartida con la lista.
- La línea bajo cada nombre es `statusLine()` (`lib/attentionRules.ts`), la misma en la lista y en la sección **Ahora** del panel Actividad: delegaciones abiertas del agente (`dispatches` con `from_id` = el agente, `queued` o `running`, la más antigua primero, sin los destinos que ya no existen), luego `activity()`, luego un aviso `done` sin leer, luego el estado de error, luego la descripción. Las delegaciones salen de `dispatches` del store, las 50 más recientes. `.sw-sub` y `.sw-meta` ocupan una línea cada una (el modelo se recorta antes que la hora), así que una fila mide unos 72 px en cualquier estado; la cabecera de grupo muestra `.sg-unread` (`attn.group.unread`) y la de la lista plegada un punto verde o rojo.
