# 2. Estructura del proyecto

hive-am es un monorepo de **npm workspaces** con dos paquetes: `server` (backend) y `web` (frontend).

```
hive-am/
├── package.json              # raíz: workspaces + scripts dev/build/typecheck
├── package-lock.json
├── README.md                 # resumen y arranque rápido
├── .gitignore
├── docs/                     # esta documentación (reference/es y reference/en)
├── server/                   # @hive-am/server — backend Node + TypeScript
│   ├── package.json
│   ├── tsconfig.json
│   ├── mcp/
│   │   └── dispatch.mjs      # servidor MCP (stdio) `hive`: delegación, canal, cuaderno y skills
│   ├── scripts/              # simulaciones con agentes reales (sim-*.ts) y una API de Telegram falsa
│   └── src/
│       ├── index.ts          # PUNTO DE ENTRADA del servidor
│       ├── api.ts            # rutas REST, validación, CORS
│       ├── runtime.ts        # cola por agente, turnos, delegación, bus de eventos
│       ├── instructions.ts   # qué se le dice a un agente (instrucciones compuestas) y qué herramientas MCP recibe
│       ├── db.ts             # esquema SQLite, migraciones, acceso a datos
│       ├── types.ts          # tipos compartidos del backend
│       ├── seed.ts           # datos iniciales de primera ejecución
│       ├── models.ts         # lista de modelos por proveedor (con caché)
│       ├── pricing.ts        # estimación de costo y suma de uso de tokens
│       ├── stats.ts          # estadísticas de una sesión (tokens, herramientas, línea de tiempo)
│       ├── mcp-config.ts     # puerto de la API y configuración MCP para cada proveedor
│       ├── git/
│       │   ├── repo.ts       # lecturas de git para el explorador de cambios
│       │   ├── ops.ts        # historial, ramas y acciones de git (commit, pull, push…)
│       │   └── switch.ts     # cambio de rama inteligente (stash y reaplicar)
│       ├── skills/
│       │   ├── defaults.ts   # las skills que vienen con hive-am (se crean una vez al instalar)
│       │   └── notebook.ts   # cuaderno del agente: tabla, límites, notas y detección de credenciales
│       ├── connections/      # conexiones externas (Telegram) — ver documento 14
│       │   ├── types.ts      # ChannelAdapter, Inbound, Connection, Thread, Origin
│       │   ├── store.ts      # tablas connections, threads, thread_messages, connection_cursor
│       │   ├── router.ts     # acceso, comandos, grupos, silencio y entrega al agente
│       │   ├── manager.ts    # adaptadores en marcha, channel_reply y channel_mute
│       │   ├── telegram.ts   # adaptador de Telegram (long polling)
│       │   ├── format.ts     # partir mensajes y Markdown → HTML de Telegram
│       │   ├── files.ts      # archivos recibidos: descarga, carpeta por agente, límites y limpieza
│       │   ├── outbound.ts   # qué archivos puede enviar un agente a un chat (rutas permitidas y prohibidas)
│       │   ├── vision.ts     # descripción de imágenes con un modelo aparte, para agentes que no ven
│       │   ├── prompt.ts     # cabecera de origen que recibe el agente
│       │   ├── public.ts     # lo que la API devuelve (sin secretos) y fusión de config
│       │   ├── rules.ts      # permiso mínimo de un agente con conexión
│       │   ├── fake.ts       # plataforma en memoria para las simulaciones
│       │   └── index.ts      # registra las plataformas disponibles
│       ├── providers/
│       │   ├── index.ts      # tabla proveedor → runner
│       │   ├── spawn.ts      # lanzador de procesos (spawnLines)
│       │   ├── preamble.ts   # preámbulo de instrucciones (OpenCode, Kiro y Claude al reanudar)
│       │   ├── claude.ts     # runner de Claude Code
│       │   ├── opencode.ts   # runner de OpenCode
│       │   └── kiro.ts       # runner de Kiro
│       └── history/
│           ├── index.ts      # readHistory(): despacha al lector correcto
│           ├── claude.ts     # lee ~/.claude/projects/**/<id>.jsonl
│           ├── opencode.ts   # lee opencode.db (SQLite, solo lectura)
│           └── kiro.ts       # lee ~/.kiro/sessions/cli/<id>.jsonl y .json
└── web/                      # @hive-am/web — frontend Next.js 15 (App Router)
    ├── package.json
    ├── tsconfig.json
    ├── next.config.mjs       # proxy /api → servidor, distDir configurable
    ├── public/logo.png       # logo de la app (PNG con fondo transparente)
    ├── app/
    │   ├── favicon.ico, icon.png, apple-icon.png   # favicon e iconos (Next los detecta por nombre)
    │   ├── layout.tsx        # raíz: fuentes, metadatos, <Shell>
    │   ├── globals.css       # TODOS los estilos (tokens, tema claro/oscuro, componentes)
    │   ├── page.tsx          # Colony (panal)
    │   ├── agents/page.tsx   # listado de agentes
    │   ├── agents/[id]/page.tsx   # espacio de trabajo del agente (chat, cambios, ajustes, cuaderno)
    │   ├── connections/page.tsx   # conexiones externas
    │   ├── types/page.tsx    # tipos de agente
    │   ├── skills/page.tsx   # biblioteca de skills
    │   ├── relations/page.tsx     # lienzo de relaciones
    │   └── sessions/page.tsx # sesiones de los agentes
    ├── components/
    │   ├── Shell.tsx         # barra lateral, tema, proveedores globales
    │   ├── ui.tsx            # primitivas: Drawer, Modal, Field, pickers (incluye SkillPicker), toasts, Hex…
    │   ├── MarkdownEditor.tsx     # editor Markdown con barra, vista dividida y atajos
    │   ├── HelpPopover.tsx   # icono de ayuda con popover
    │   ├── ConnectionDrawer.tsx   # crear/editar una conexión
    │   ├── agents/           # todo lo que crea o edita agentes y colonias
    │   │   ├── AgentForm.tsx          # formulario único de agente (crear y editar)
    │   │   ├── useAgentSettings.tsx   # guardar/descartar/borrar compartido por los paneles
    │   │   ├── NewAgentDrawer.tsx     # asistente "nuevo agente"
    │   │   ├── AgentEditDrawer.tsx    # edición de un agente en un panel lateral
    │   │   ├── AgentSwitcher.tsx      # lista lateral para cambiar de agente
    │   │   ├── AgentCard.tsx          # tarjeta con los datos de un agente al pasar el cursor
    │   │   ├── DeleteAgentModal.tsx   # confirmar y borrar
    │   │   ├── ColonyEditor.tsx       # crear/editar colonias + pregunta de herencia
    │   │   └── NotebookPanel.tsx      # pestaña Cuaderno de los ajustes del agente
    │   ├── chat/             # la conversación
    │   │   ├── Chat.tsx      # transcripción, vista en vivo, caja de texto
    │   │   ├── ToolCall.tsx  # render de cada herramienta que usa el agente
    │   │   ├── UserBubble.tsx    # mensaje del usuario (con la burbuja de canal)
    │   │   └── StatsBar.tsx  # barra y panel de tokens, costo y herramientas
    │   └── git/              # pestaña Cambios
    │       ├── GitExplorer.tsx    # árbol con resaltado, visor de archivos y diferencias, historial y stashes
    │       ├── GitActions.tsx     # botones de git, menú de ramas, commit, historial
    │       ├── GitSettings.tsx    # tema, espacios visibles y tabulación del código
    │       ├── DiffView.tsx       # diferencias unificadas y lado a lado
    │       ├── VirtualLines.tsx   # filas virtualizadas para archivos enormes
    │       ├── Code.tsx / CodeEditor.tsx  # código resaltado y su editor
    │       ├── ConflictResolver.tsx       # resolución de conflictos
    │       ├── StashManager.tsx   # lista y vista de stashes
    │       ├── SwitchDialog.tsx   # aviso antes de cambiar de rama con otros agentes trabajando
    │       └── StatusLetter.tsx   # letra de estado (M, A, D…)
    └── lib/
        ├── api.ts            # cliente fetch hacia /api (traduce los errores del servidor)
        ├── store.tsx         # estado global + WebSocket
        ├── types.ts          # tipos del frontend (espejo de los del backend)
        ├── meta.ts           # nombres/colores de proveedores, permisos, utilidades
        ├── format.ts         # formato de tokens, costo, duración, bytes y números
        ├── tokens.ts         # tamaño estimado de las skills en tokens
        ├── channel.ts        # lee la cabecera de origen de un mensaje de canal
        ├── activity.ts       # «qué está haciendo» un agente en una línea
        ├── useDismiss.ts     # cerrar al hacer clic fuera o con Escape
        ├── git/              # utilidades de la pestaña Cambios
        │   ├── useGit.ts     # hook del explorador de cambios
        │   ├── gitTree.ts    # árbol de archivos
        │   ├── diff.ts       # parser de diff unificado y marcas de cambio
        │   ├── conflicts.ts  # bloques de conflicto y cómo resolverlos
        │   ├── gitPrefs.ts   # preferencias de visualización (en el navegador)
        │   ├── highlight.ts  # resaltado de sintaxis por líneas
        │   ├── highlight.worker.ts  # el mismo resaltado fuera del hilo principal
        │   └── useHighlighted.ts    # elige entre resaltar al instante o en el worker
        └── i18n/
            ├── core.ts       # idiomas, translate(), detección, errores del servidor
            ├── index.tsx     # I18nProvider y useI18n()
            ├── en.ts         # catálogo en inglés (fuente de todas las claves)
            └── es.ts         # catálogo en español (debe tener las mismas claves)
```

No existen aún carpetas de pruebas automatizadas; la verificación se describe en el [documento 12](12-operacion-y-problemas.md).

## Backend: responsabilidad de cada archivo

| Archivo | Responsabilidad |
|---|---|
| `index.ts` | Ejecuta `seedIfEmpty()`, crea el servidor HTTP en `127.0.0.1:<puerto>`, monta el WebSocket en `/ws` y suscribe cada cliente al bus de eventos del runtime. |
| `api.ts` | Tabla de rutas (`route(método, ruta, handler)`), lectura del cuerpo JSON, errores `HttpError` (400/404), CORS abierto, detección de proveedores instalados, selector de carpetas. |
| `runtime.ts` | `sendTurn` (cola por agente), `execute` (un turno), `dispatch` (delegación), `stopAgent`, `liveTurn`, `liveOrigin`, `bus`. |
| `instructions.ts` | `composeInstructions` (identidad, prompt, skills, equipo, canales, cuaderno), `notebookBlock`, `lazySkills` y `mcpCaps`: qué herramientas MCP recibe cada agente. |
| `db.ts` | Crea las tablas, aplica migraciones ligeras, expone `skills`, `types`, `colonies`, `agents`, `dispatches` y la función `resolved()`; guarda también cómo se carga cada skill asignada. |
| `types.ts` | `Agent`, `Colony`, `AgentType`, `Skill`, `StreamEvent`, `Block`, `ChatMessage`, `Usage`, `TurnOptions`, etc. |
| `seed.ts` | Si la base está vacía crea 2 skills y 3 tipos (Queen, Builder, Reviewer). |
| `skills/defaults.ts` | Las nueve skills que vienen con hive-am (`skills.seedDefaults` las crea una sola vez); ver [7.3](07-agentes-tipos-skills-colonias.md#73-skills). |
| `skills/notebook.ts` | El cuaderno de cada agente: tabla `agent_notebooks`, límites, notas sin duplicados, rechazo de credenciales y versiones. |
| `connections/*` | Conexiones externas (Telegram): adaptador, enrutador de mensajes, grupos, silencio y herramientas del canal; ver [documento 14](14-conexiones-externas.md). |
| `models.ts` | Modelos disponibles por proveedor; caché de 10 minutos. |
| `pricing.ts` | Tabla de precios por familia (opus/sonnet/haiku) y utilidades de suma de uso. |
| `stats.ts` | `sessionStats(mensajes)`: totales de tokens, costo, herramientas, modelos y línea de tiempo por turno. |
| `git/ops.ts` | Historial, ramas y acciones que escriben (commit, pull, push, fetch, switch, merge); ver [documento 13](13-explorador-de-cambios-git.md#138-acciones-de-git-e-historial). |
| `git/repo.ts` | Lecturas de git (estado, árbol, diff, contenido, imágenes) con validación de rutas; ver [documento 13](13-explorador-de-cambios-git.md). |
| `git/switch.ts` | Cambio de rama inteligente: lleva los cambios locales, o los guarda en un stash y los reaplica; deja los conflictos al resolutor. |
| `mcp-config.ts` | `API_PORT` (variable `HIVE_AM_PORT`, 4400 por defecto) y los objetos de configuración MCP que se entregan a cada proveedor. |
| `providers/spawn.ts` | `spawnLines`: lanza el CLI, entrega stdout línea a línea, maneja cancelación, errores y `PWD`. |
| `providers/claude.ts`, `opencode.ts`, `kiro.ts` | Un generador asíncrono por proveedor que produce `StreamEvent`. |
| `providers/preamble.ts` | `withInstructions`: antepone las instrucciones al mensaje (OpenCode y Kiro siempre; Claude solo al reanudar una sesión cuyas instrucciones cambiaron). |
| `history/*.ts` | Lectura de transcripciones nativas y normalización a `ChatMessage[]`. |
| `mcp/dispatch.mjs` | Servidor MCP mínimo por stdio; solo habla con la API HTTP de hive-am. Anuncia las herramientas según `HIVE_CAPS`: `dispatch`, `channel` (incluye enviar archivos), `memory` y `skills`. |

## Frontend: responsabilidad de cada archivo

| Archivo | Responsabilidad |
|---|---|
| `app/layout.tsx` | Carga las fuentes (Bricolage Grotesque, Hanken Grotesk, JetBrains Mono) y envuelve todo en `<Shell>`. |
| `app/page.tsx` | Pantalla **Colony**: panal con colonias, líneas de relación, panel del agente seleccionado y delegaciones recientes. |
| `app/agents/page.tsx` | Tabla filtrable de agentes. |
| `app/agents/[id]/page.tsx` | Selector de agentes + chat + pestaña Cambios + panel de ajustes plegable (configuración, cuaderno y sesiones). |
| `app/connections/page.tsx` | Pantalla **Conexiones**: tarjetas de las conexiones externas y su estado. |
| `app/types/page.tsx` | CRUD de tipos y creación de agentes a partir de un tipo. |
| `app/skills/page.tsx` | CRUD de skills con vista previa markdown, conteo de uso y tamaño estimado. |
| `app/relations/page.tsx` | Lienzo (React Flow) para ver y editar qué orquestador delega a qué worker. |
| `app/sessions/page.tsx` | Lista de sesiones por día con transcripción en lectura. |
| `components/Shell.tsx` | Navegación lateral, estado de conexión, cambio de tema, `HiveProvider` y `Toaster`. |
| `components/ui.tsx` | `Hex`, `ProviderBadge`, `StatusChip`, `RoleChip`, `Drawer`, `Modal`, `Field`, `Segmented`, `ProviderPicker`, `ModelField`, `PermissionField`, `SkillPicker`, `FolderPicker`, `Toaster`… |
| `components/agents/*` | Formularios y paneles de agentes y colonias (`AgentForm` es el formulario compartido y maneja la herencia desde la colonia); `NotebookPanel` edita el cuaderno. |
| `components/chat/*` | `Chat` (transcripción memoizada, turno en vivo, tarjeta de delegación), `ToolCall` (cada herramienta como fila legible), `UserBubble` y `StatsBar`. |
| `components/git/*` | La pestaña **Cambios**: `GitExplorer` (árbol, visor de archivos y diferencias, historial, stashes), `GitActions` (Fetch/Pull/Push/Commit, ramas), `DiffView`, `ConflictResolver`, etc. |
| `lib/store.tsx` | Estado global, WebSocket y reductor de eventos. |
| `lib/git/*` | Utilidades de la pestaña Cambios: hook `useGit`, árbol, diff, conflictos, preferencias y resaltado de sintaxis (con su worker). |
| `lib/tokens.ts`, `lib/channel.ts` | Tamaño estimado de las skills, y lectura de la cabecera de origen de los mensajes de canal. |
| `lib/i18n/*` | Traducciones de la interfaz (inglés y español); ver [documento 11](11-frontend.md#118-internacionalización-i18n). |

## Dependencias principales

**Backend** (`server/package.json`): `better-sqlite3` (SQLite síncrono), `ws` (WebSocket); desarrollo: `tsx`, `typescript`, tipos.
No usa Express ni Fastify: el enrutador es propio y pequeño.

**Frontend** (`web/package.json`): `next` 15, `react` 19, `@xyflow/react` (lienzo de relaciones), `lucide-react` (iconos), `react-markdown` + `remark-gfm` (markdown del chat y de skills).

**Raíz**: `concurrently` para arrancar ambos con un solo comando.

## Archivos generados o ignorados

Están en `.gitignore`: `node_modules`, `.next` y `.next-*` (salida de Next), `*.log`, `*.tsbuildinfo`, `next-env.d.ts`, `.DS_Store`, `.env*` (salvo `.env.example`).

Fuera del repositorio, hive-am escribe en `~/.hive-am/` (ver [documento 4](04-almacenamiento.md)).
