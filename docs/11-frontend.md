# 11. Frontend

Next.js 15 (App Router) + React 19 + TypeScript. Casi todo es **componente de cliente** (`'use client'`): la interfaz depende de estado en vivo y del WebSocket, así que no se usa renderizado en servidor para datos.

## 11.1 Pantallas

### Colony (`/`, `app/page.tsx`)

Mapa del enjambre y panel de detalle.

- **Cabecera:** el título con un icono de ayuda (**?**) que abre un popover con "cómo leer el mapa" (se cierra con Esc, clic fuera o el mismo icono), y los botones **New colony** y **New agent**.
- **Estadísticas:** agentes, colonias, orquestadores, trabajando ahora y tareas en curso.
- **Panal:** una celda hexagonal por agente, agrupadas por colonia (ver 11.2).
- **Panel derecho:** al seleccionar una celda muestra descripción, proveedor, modelo, carpeta efectiva ("· from colony" si es heredada), sesión, equipo (orquestadores), un **selector de colonia** (mueve al agente), botón **Open chat** y, en la esquina superior derecha, el botón de **ajustes** que abre `AgentEditDrawer`.
- **Recent delegations:** últimas 6, se refrescan cada 6 s.

### Agents (`/agents`)

Tabla con búsqueda (nombre, descripción, carpeta), filtros por rol y proveedor, y columnas: agente, proveedor · modelo, colonia, carpeta efectiva, estado y última actualización. La fila completa es clicable. Estados vacíos distintos para "sin agentes" y "sin resultados".

### Agente (`/agents/<id>`)

Selector de agentes + chat + ajustes plegables (ver [documento 10](10-chat-y-visualizacion.md)). En la cabecera, el control **Chat / Cambios** alterna entre la conversación y el [explorador de cambios de git](13-explorador-de-cambios-git.md). El panel de ajustes tiene dos pestañas:

- **Configuration:** `AgentForm` completo con barra inferior *Save changes* / *Discard* y botón *Delete agent* (con confirmación).
- **Sessions:** conversaciones y tareas delegadas.

Cabecera: volver a Colony, avatar, nombre, rol, proveedor, modelo, estado, **New conversation** (con confirmación) y **Settings**.

### Connections (`/connections`)
Tarjetas de las conexiones externas con su estado en vivo (se refresca cada 5 s) y un panel lateral para crearlas o editarlas. Detalle en el [documento 14](14-conexiones-externas.md).

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
| `Drawer` / `Modal` | Panel lateral y diálogo; se cierran con Esc o clic en el fondo. El `Drawer` es **ampliable**: botón de ampliar en su cabecera (560 px ↔ 1100 px), borde izquierdo arrastrable (mín. 420 px, máx. pantalla − 80 px) y doble clic para alternar; el ancho se recuerda en `localStorage` (`hive-am.drawerWidth`) y lo comparten todos los paneles (crear y editar agente, etc.) |
| `Field`, `Segmented` | Campo con etiqueta, ayuda y error; control segmentado |
| `ProviderPicker` | Tres tarjetas con indicador de instalado |
| `ModelField` | Texto libre con sugerencias del proveedor |
| `PermissionField` | Control segmentado con la explicación del permiso elegido |
| `SkillPicker` | Lista de skills con casillas (`.skillrow` + `.check`), se reutiliza para miembros de colonia y equipos |
| `SkillPicker` (modo y peso) | Cada skill elegida es una pill con su botón `siempre` / `a demanda` (se elige por agente, tipo o colonia); bajo el selector se suma lo que va siempre en el prompt |
| `NotebookPanel` | Pestaña **Cuaderno** de los ajustes del agente: edita su memoria (ver 7.3.2) |
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
| `.split` (diseño de dos paneles de Skills/Tipos, con `display: grid`) usada como modificador de la tabla de diffs | La vista "lado a lado" del explorador quedaba de 340 px | Renombrado a `.is-split` (y `.empty` → `.void`) |

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
| Cuaderno | `GET/PUT /api/agents/:id/notebook` |
| Relations | `PUT /api/orchestrators/:id/workers` |
| Sessions | `GET /api/sessions`; `GET /api/agents/:id/history?session=` |
| Formularios | `GET /api/providers/:p/models`; `GET /api/fs/dirs` |

## 11.8 Internacionalización (i18n)

Toda la interfaz está disponible en **inglés** y **español**. El sistema es propio y pequeño (sin librerías) y vive en `web/lib/i18n/`.

### Selector de idioma

- Está **arriba de la barra lateral**, debajo del logo: un control `EN | ES` (`LanguageSwitch` en `components/Shell.tsx`).
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
