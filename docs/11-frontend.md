# 11. Frontend

Next.js 15 (App Router) + React 19 + TypeScript. Casi todo es **componente de cliente** (`'use client'`): la interfaz depende de estado en vivo y del WebSocket, así que no se usa renderizado en servidor para datos.

## 11.1 Pantallas

### Colony (`/`, `app/page.tsx`)

Mapa del enjambre y panel de detalle.

- **Cabecera:** botones **New colony** y **New agent**.
- **Estadísticas:** agentes, colonias, orquestadores, trabajando ahora y tareas en curso.
- **Panal:** una celda hexagonal por agente, agrupadas por colonia (ver 11.2).
- **Panel derecho:** al seleccionar una celda muestra descripción, proveedor, modelo, carpeta efectiva ("· from colony" si es heredada), sesión, equipo (orquestadores), un **selector de colonia** (mueve al agente), botón **Open chat** y, en la esquina superior derecha, el botón de **ajustes** que abre `AgentEditDrawer`. Sin selección explica cómo leer el mapa.
- **Recent delegations:** últimas 6, se refrescan cada 6 s.

### Agents (`/agents`)

Tabla con búsqueda (nombre, descripción, carpeta), filtros por rol y proveedor, y columnas: agente, proveedor · modelo, colonia, carpeta efectiva, estado y última actualización. La fila completa es clicable. Estados vacíos distintos para "sin agentes" y "sin resultados".

### Agente (`/agents/<id>`)

Selector de agentes + chat + ajustes plegables (ver [documento 10](10-chat-y-visualizacion.md)). El panel de ajustes tiene dos pestañas:

- **Configuration:** `AgentForm` completo con barra inferior *Save changes* / *Discard* y botón *Delete agent* (con confirmación).
- **Sessions:** conversaciones y tareas delegadas.

Cabecera: volver a Colony, avatar, nombre, rol, proveedor, modelo, estado, **New conversation** (con confirmación) y **Settings**.

### Types (`/types`)

Tarjetas de tipos (rol, proveedor, modelo, nº de skills, nº de agentes que lo usan) con **Edit** (panel lateral) y **Create agent**. El editor incluye selector de proveedor, modelo, permisos, prompt (monoespaciado, con contador de caracteres) y skills.

### Skills (`/skills`)

Lista a la izquierda (búsqueda y uso `N agents · M types`) y editor a la derecha (nombre, descripción, instrucciones con pestañas *Write/Preview*). Botón *Delete* con confirmación que indica a cuántos agentes/tipos afecta.

### Relations (`/relations`)

Lienzo de React Flow; ver [documento 9](09-orquestacion-y-relaciones.md#lienzo-relations-apprelationspagetsx).

### Sessions (`/sessions`)

Lista por día con búsqueda y filtro por proveedor, y panel de transcripción (solo texto, markdown) con enlace **Open agent**.

## 11.2 El panal (mapa de Colony)

Implementado en `app/page.tsx`, sin librerías de gráficos: celdas HTML posicionadas de forma absoluta y capas SVG.

**Geometría.** Hexágonos de punta arriba con radio `S = 74`; ancho `W = √3·S`, alto `H = 2·S`. Las posiciones salen de **coordenadas axiales** recorridas en espiral (anillo 0, 1, 2…), con `x = W·(q + r/2)` e `y = 1.5·S·r`.

**Agrupación.**

1. Se crea un *cluster* por colonia y uno extra "No colony" para los agentes sin colonia (se omite si está vacío y ya hay agentes).
2. Dentro de cada cluster el orden es: orquestadores primero (centro), luego los workers que ellos conectan (`orderMembers`), luego el resto. Así las conexiones directas quedan cerca.
3. A cada cluster se le añade una **celda fantasma** "Add agent" (crea el agente ya dentro de esa colonia). Una colonia vacía muestra solo esa celda.
4. Los clusters se acomodan por filas (*shelf packing*) con ancho máximo de fila 880 px, separación 36 px, margen interior 26 px y 50 px arriba para la etiqueta.

**Contorno de la colonia (solo rodea los hexágonos).** Para cada cluster se dibujan los polígonos de sus hexágonos **dos veces** en un SVG bajo las celdas: primero con un trazo ancho del color de la colonia y uniones redondeadas, luego encima con un trazo algo menos ancho del color de fondo teñido. Lo que sobresale es un anillo continuo que sigue el borde exterior de la unión; no hace falta calcular la unión geométrica.

**Celdas.** Botones con `clip-path` hexagonal. Borde del color del proveedor; las celdas de orquestador usan el color miel. Un punto pulsante indica trabajo; rojo si hay error. Etiqueta con nombre y proveedor, y una pastilla `↑ nombre` / `↓ N` que indica la relación.

**Relaciones.** SVG por encima de las celdas (ver [documento 9](09-orquestacion-y-relaciones.md#pantalla-colony-apppagetsx)).

**Ajuste a la pantalla.** Un `ResizeObserver` mide el panel y escala el mapa completo con `transform: scale(k)` (`k ≤ 1`, nunca amplía) para que quepa sin scroll horizontal.

**Hover/selección.** El estado `focus = hover ?? seleccionado` decide qué celdas y líneas se resaltan o se atenúan (`dim`, `linked`).

## 11.3 Estado global (`lib/store.tsx`)

Un solo contexto React (`useHive()`), sin librerías de estado. Contiene los datos (agentes, tipos, skills, colonias, proveedores), el estado de conexión, los turnos en vivo y el contador `finished`. Expone `refresh(['agents'|'types'|'skills'|'colonies'])`, `agent(id)` y `clearLive(id)`. Detalle del WebSocket en el [documento 5](05-comunicacion-back-front.md#56-estado-en-el-navegador-libstoretsx).

`lib/types.ts` **replica a mano** los tipos del backend (`server/src/types.ts`). No hay paquete compartido: si cambias un tipo de la API, actualiza ambos.

## 11.4 Componentes compartidos

| Componente | Función |
|---|---|
| `Hex` | Avatar hexagonal con iniciales; color del proveedor, o miel si es orquestador; tamaños `sm`, normal, `lg` |
| `ProviderBadge`, `StatusChip`, `RoleChip` | Etiquetas pequeñas de proveedor, estado y rol |
| `Drawer` / `Modal` | Panel lateral y diálogo; se cierran con Esc o clic en el fondo |
| `Field`, `Segmented` | Campo con etiqueta, ayuda y error; control segmentado |
| `ProviderPicker` | Tres tarjetas con indicador de instalado |
| `ModelField` | Texto libre con sugerencias del proveedor |
| `PermissionField` | Control segmentado con la explicación del permiso elegido |
| `SkillPicker` | Lista de skills con casillas (`.skillrow` + `.check`); se reutiliza para miembros de colonia y equipos |
| `FolderPicker` | Campo de ruta + explorador de carpetas (usa `GET /api/fs/dirs`) |
| `Toaster` / `useToast` | Avisos transitorios |
| `AgentForm` | Formulario único de agente (incluye herencia y *Team*) |
| `ColonyEditor` | Editor de colonias + diálogo de herencia |
| `NewAgentDrawer`, `AgentEditDrawer` | Crear y editar agentes en panel lateral |

## 11.5 Estilos y tema (`app/globals.css`)

Un solo archivo CSS, organizado por secciones comentadas (shell, primitivas, hex, colony, tabla, espacio de trabajo, chat, herramientas, estadísticas, colonias, lienzo, selector…).

### Tokens de diseño

Definidos en `:root` y redefinidos para el tema oscuro:

| Grupo | Variables |
|---|---|
| Superficies | `--bg`, `--bg-deep`, `--surface`, `--surface-2` |
| Texto | `--ink`, `--ink-2`, `--muted` |
| Líneas | `--line`, `--line-strong` |
| Acento | `--honey`, `--honey-ink`, `--honey-soft` (miel: orquestadores y acciones primarias) |
| Estado | `--ok`, `--err`, `--err-soft` |
| Proveedores | `--p-claude`, `--p-opencode`, `--p-kiro` |
| Forma | `--radius`, `--radius-sm`, `--shadow` |
| Tipografía | `--font-display` (Bricolage Grotesque), `--font-body` (Hanken Grotesk), `--font-mono` (JetBrains Mono) |

### Tema claro/oscuro

- Atributo `data-theme` en `<html>`: `light` o `dark`. Sin atributo se sigue `prefers-color-scheme`.
- El botón **Switch theme** (barra lateral) alterna y guarda la elección en `localStorage` (`hive-theme`).
- Las iniciales de los hexágonos son oscuras en tema oscuro para mantener el contraste.

### Tipografía

Las fuentes se cargan con `next/font/google` en `layout.tsx`, por lo que **la primera compilación necesita red**; sin ella se usan las fuentes del sistema (hay `fallback` en las variables).

### Responsivo y accesibilidad

- Puntos de corte: **1100 px** (las columnas se apilan) y **760 px** (la barra lateral pasa a barra superior).
- Foco visible en todos los controles (`:focus-visible`), `aria-label` en botones de solo icono, `aria-pressed`/`aria-current`/`aria-selected` en controles de estado, `role="dialog"` en paneles y diálogos.
- `prefers-reduced-motion` desactiva animaciones y transiciones.

### Convención y una lección aprendida

Los selectores son **globales**: un nombre de clase genérico puede chocar con otro componente. Se han corregido tres casos:

| Choque | Síntoma | Solución |
|---|---|---|
| `.shell` (layout de la app) usada también como modificador de la fila de Shell | La fila de herramienta Shell se volvía enorme y vacía | Renombrado a `.is-shell` |
| `.empty` (estado vacío) usada como modificador del subtítulo del selector | Las filas del selector se deformaban | Renombrado a `.blank` |
| `.name-cell span` (descripción) alcanzaba también al avatar `<span class="hex">` | Iniciales grises ilegibles en la tabla de agentes | Acotado a `.name-cell > div > span` |

**Regla práctica:** antes de añadir una clase modificadora, busca (`grep`) que el nombre no exista ya en `globals.css`; y acota los selectores de descendientes (`>`) cuando contengan componentes reutilizables.

## 11.6 Rendimiento

- El historial del chat está memoizado (`History`), cada bloque markdown también (`Md`, `Blocks`), y la caja de texto guarda su propio estado.
- El mapa se calcula con `useMemo` a partir de agentes y colonias.
- El lienzo de relaciones usa su propio estado de nodos y solo recalcula el layout cuando cambian los agentes.

## 11.7 Datos que la interfaz espera

Resumen de lo que cada pantalla necesita del backend, para quien toque la API:

| Pantalla | Endpoints |
|---|---|
| Todas | `GET /api/agents`, `/types`, `/skills`, `/colonies`, `/providers`, WebSocket |
| Colony | `GET /api/dispatches`; `PATCH /api/agents/:id` (mover de colonia); `POST/PATCH/DELETE /api/colonies` |
| Agente | `GET …/history`, `…/stats`, `…/live`, `…/sessions`; `POST …/messages`, `…/stop`, `…/new-session`, `…/resume-session`; `PATCH/DELETE /api/agents/:id` |
| Types | `POST/PATCH/DELETE /api/types` |
| Skills | `GET /api/skills/usage`; `POST/PATCH/DELETE /api/skills` |
| Relations | `PUT /api/orchestrators/:id/workers` |
| Sessions | `GET /api/sessions`; `GET /api/agents/:id/history?session=` |
| Formularios | `GET /api/providers/:p/models`; `GET /api/fs/dirs` |
