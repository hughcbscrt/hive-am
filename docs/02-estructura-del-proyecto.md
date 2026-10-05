# 2. Estructura del proyecto

hive-am es un monorepo de **npm workspaces** con dos paquetes: `server` (backend) y `web` (frontend).

```
hive-am/
├── package.json              # raíz: workspaces + scripts dev/build/typecheck
├── package-lock.json
├── README.md                 # resumen y arranque rápido
├── .gitignore
├── docs/                     # esta documentación
├── server/                   # @hive-am/server — backend Node + TypeScript
│   ├── package.json
│   ├── tsconfig.json
│   ├── mcp/
│   │   └── dispatch.mjs      # servidor MCP (stdio) con list_agents y dispatch
│   └── src/
│       ├── index.ts          # PUNTO DE ENTRADA del servidor
│       ├── api.ts            # rutas REST, validación, CORS
│       ├── runtime.ts        # cola por agente, turnos, delegación, bus de eventos
│       ├── db.ts             # esquema SQLite, migraciones, acceso a datos
│       ├── types.ts          # tipos compartidos del backend
│       ├── seed.ts           # datos iniciales de primera ejecución
│       ├── models.ts         # lista de modelos por proveedor (con caché)
│       ├── pricing.ts        # estimación de costo y suma de uso de tokens
│       ├── stats.ts          # estadísticas de una sesión (tokens, herramientas, línea de tiempo)
│       ├── mcp-config.ts     # puerto de la API y configuración MCP para Claude/OpenCode
│       ├── providers/
│       │   ├── index.ts      # tabla proveedor → runner
│       │   ├── spawn.ts      # lanzador de procesos (spawnLines)
│       │   ├── preamble.ts   # preámbulo de instrucciones para OpenCode/Kiro
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
    ├── app/
    │   ├── layout.tsx        # raíz: fuentes, metadatos, <Shell>
    │   ├── globals.css       # TODOS los estilos (tokens, tema claro/oscuro, componentes)
    │   ├── page.tsx          # Colony (panal)
    │   ├── agents/page.tsx   # listado de agentes
    │   ├── agents/[id]/page.tsx   # espacio de trabajo del agente (chat + ajustes)
    │   ├── types/page.tsx    # tipos de agente
    │   ├── skills/page.tsx   # biblioteca de skills
    │   ├── relations/page.tsx     # lienzo de relaciones
    │   └── sessions/page.tsx # sesiones de los agentes
    ├── components/
    │   ├── Shell.tsx         # barra lateral, tema, proveedores globales
    │   ├── ui.tsx            # primitivas: Drawer, Modal, Field, pickers, toasts, Hex…
    │   ├── AgentForm.tsx     # formulario único de agente (crear y editar)
    │   ├── NewAgentDrawer.tsx     # asistente "nuevo agente"
    │   ├── AgentEditDrawer.tsx    # edición de un agente en un panel lateral
    │   ├── AgentSwitcher.tsx # lista lateral para cambiar de agente
    │   ├── ColonyEditor.tsx  # crear/editar colonias + pregunta de herencia
    │   ├── Chat.tsx          # transcripción, vista en vivo, caja de texto
    │   ├── ToolCall.tsx      # render de cada herramienta que usa el agente
    │   └── StatsBar.tsx      # barra y panel de tokens, costo y herramientas
    └── lib/
        ├── api.ts            # cliente fetch hacia /api
        ├── store.tsx         # estado global + WebSocket
        ├── types.ts          # tipos del frontend (espejo de los del backend)
        ├── meta.ts           # nombres/colores de proveedores, permisos, utilidades
        └── format.ts         # formato de tokens, costo y duración
```

No existen aún carpetas de pruebas automatizadas; la verificación se describe en el [documento 12](12-operacion-y-problemas.md).

## Backend: responsabilidad de cada archivo

| Archivo | Responsabilidad |
|---|---|
| `index.ts` | Ejecuta `seedIfEmpty()`, crea el servidor HTTP en `127.0.0.1:<puerto>`, monta el WebSocket en `/ws` y suscribe cada cliente al bus de eventos del runtime. |
| `api.ts` | Tabla de rutas (`route(método, ruta, handler)`), lectura del cuerpo JSON, errores `HttpError` (400/404), CORS abierto, detección de proveedores instalados, selector de carpetas. |
| `runtime.ts` | `sendTurn` (cola por agente), `execute` (un turno), `composeInstructions`, `dispatch` (delegación), `stopAgent`, `liveTurn`, `bus`. |
| `db.ts` | Crea las tablas, aplica migraciones ligeras, expone `skills`, `types`, `colonies`, `agents`, `dispatches` y la función `resolved()`. |
| `types.ts` | `Agent`, `Colony`, `AgentType`, `Skill`, `StreamEvent`, `Block`, `ChatMessage`, `Usage`, `TurnOptions`, etc. |
| `seed.ts` | Si la base está vacía crea 2 skills y 3 tipos (Queen, Builder, Reviewer). |
| `models.ts` | Modelos disponibles por proveedor; caché de 10 minutos. |
| `pricing.ts` | Tabla de precios por familia (opus/sonnet/haiku) y utilidades de suma de uso. |
| `stats.ts` | `sessionStats(mensajes)`: totales de tokens, costo, herramientas, modelos y línea de tiempo por turno. |
| `mcp-config.ts` | `API_PORT` (variable `HIVE_AM_PORT`, 4400 por defecto) y los objetos de configuración MCP que se entregan a Claude y OpenCode. |
| `providers/spawn.ts` | `spawnLines`: lanza el CLI, entrega stdout línea a línea, maneja cancelación, errores y `PWD`. |
| `providers/claude.ts`, `opencode.ts`, `kiro.ts` | Un generador asíncrono por proveedor que produce `StreamEvent`. |
| `providers/preamble.ts` | `withInstructions`: antepone las instrucciones al mensaje en proveedores sin flag de system prompt. |
| `history/*.ts` | Lectura de transcripciones nativas y normalización a `ChatMessage[]`. |
| `mcp/dispatch.mjs` | Servidor MCP mínimo por stdio; solo habla con la API HTTP de hive-am. |

## Frontend: responsabilidad de cada archivo

| Archivo | Responsabilidad |
|---|---|
| `app/layout.tsx` | Carga las fuentes (Bricolage Grotesque, Hanken Grotesk, JetBrains Mono) y envuelve todo en `<Shell>`. |
| `app/page.tsx` | Pantalla **Colony**: panal con colonias, líneas de relación, panel del agente seleccionado y delegaciones recientes. |
| `app/agents/page.tsx` | Tabla filtrable de agentes. |
| `app/agents/[id]/page.tsx` | Selector de agentes + chat + panel de ajustes plegable (configuración y sesiones). |
| `app/types/page.tsx` | CRUD de tipos y creación de agentes a partir de un tipo. |
| `app/skills/page.tsx` | CRUD de skills con vista previa markdown y conteo de uso. |
| `app/relations/page.tsx` | Lienzo (React Flow) para ver y editar qué orquestador delega a qué worker. |
| `app/sessions/page.tsx` | Lista de sesiones por día con transcripción en lectura. |
| `components/Shell.tsx` | Navegación lateral, estado de conexión, cambio de tema, `HiveProvider` y `Toaster`. |
| `components/ui.tsx` | `Hex`, `ProviderBadge`, `StatusChip`, `RoleChip`, `Drawer`, `Modal`, `Field`, `Segmented`, `ProviderPicker`, `ModelField`, `PermissionField`, `SkillPicker`, `FolderPicker`, `Toaster`. |
| `components/AgentForm.tsx` | Formulario compartido; maneja la herencia desde la colonia. |
| `components/Chat.tsx` | Transcripción memoizada, turno en vivo, tarjeta de delegación, caja de texto aislada. |
| `components/ToolCall.tsx` | Convierte cada llamada a herramienta en una fila legible (`describe`). |
| `components/StatsBar.tsx` | Resumen de la sesión y panel desplegable. |
| `lib/store.tsx` | Estado global, WebSocket y reductor de eventos. |

## Dependencias principales

**Backend** (`server/package.json`): `better-sqlite3` (SQLite síncrono), `ws` (WebSocket); desarrollo: `tsx`, `typescript`, tipos.
No usa Express ni Fastify: el enrutador es propio y pequeño.

**Frontend** (`web/package.json`): `next` 15, `react` 19, `@xyflow/react` (lienzo de relaciones), `lucide-react` (iconos), `react-markdown` + `remark-gfm` (markdown del chat y de skills).

**Raíz**: `concurrently` para arrancar ambos con un solo comando.

## Archivos generados o ignorados

Están en `.gitignore`: `node_modules`, `.next` y `.next-*` (salida de Next), `*.log`, `*.tsbuildinfo`, `next-env.d.ts`, `.DS_Store`, `.env*` (salvo `.env.example`).

Fuera del repositorio, hive-am escribe en `~/.hive-am/` (ver [documento 4](04-almacenamiento.md)).
