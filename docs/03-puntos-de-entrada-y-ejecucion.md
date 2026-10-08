# 3. Puntos de entrada y ejecución

## Requisitos

- Node.js 20 o superior (probado con 20.19).
- Los CLIs que quieras usar, instalados y con sesión iniciada: `claude`, `opencode`, `kiro-cli`. No hace falta tener los tres.
- Desarrollado y probado en Linux. Se usa `better-sqlite3` (módulo nativo con binarios precompilados); en otros sistemas puede requerir herramientas de compilación.

## Cómo arrancar

```bash
npm install          # en la raíz: instala server y web (workspaces)
npm run dev          # arranca servidor (:4400) y web (:4401) juntos
```

Abre `http://localhost:4401`.

### Scripts

| Dónde | Script | Qué hace |
|---|---|---|
| raíz | `npm run dev` | `concurrently` ejecuta `dev` del servidor y de la web |
| raíz | `npm run build` | Compila la web (`next build`) |
| raíz | `npm run typecheck` | `tsc --noEmit` en server y web |
| `server` | `npm run dev` | `tsx watch src/index.ts` (recarga al cambiar código) |
| `server` | `npm run start` | `tsx src/index.ts` (sin recarga) |
| `web` | `npm run dev` | `next dev -p 4401` |
| `web` | `npm run start` | `next start -p 4401` (requiere `build`) |

> **Nota:** `tsx watch` recarga el servidor al cambiar el código. Un servidor iniciado con `npm run start` o con `npx tsx src/index.ts` **no** recarga: hay que reiniciarlo para ver cambios del backend.

## Puntos de entrada

### 1. Servidor: `server/src/index.ts`

Secuencia de arranque:

1. Se importa `db.ts`: abre (o crea) `~/.hive-am/hive-am.db`, crea las tablas, aplica migraciones y **normaliza el estado tras un apagón** (ver abajo).
2. `skills.seedDefaults()` crea, una sola vez cada una, las skills que vienen con hive-am; después `seedIfEmpty()` crea el kit inicial solo si no hay tipos, agentes ni skills propias.
3. Se crea un `http.createServer` cuyo handler es `handle()` de `api.ts`.
4. Se monta un `WebSocketServer` en la ruta `/ws` sobre el mismo servidor HTTP.
5. Cada conexión WebSocket se suscribe al `bus` del runtime y reenvía cada mensaje como JSON; al cerrarse se desuscribe.
6. `server.listen(API_PORT, '127.0.0.1')` y escribe en consola `hive-am server → http://127.0.0.1:4400`.

**Recuperación tras un apagón** (al final de `db.ts`, se ejecuta en cada arranque):

```sql
UPDATE agents     SET status='idle'         WHERE status='running';
UPDATE dispatches SET status='interrupted'  WHERE status='running';
```

El turno que estaba en vuelo se pierde, pero la sesión nativa está intacta y el agente queda libre.

### 2. Servidor MCP: `server/mcp/dispatch.mjs`

No se ejecuta manualmente. Lo lanza el propio CLI (Claude u OpenCode) cuando un orquestador tiene subagentes conectados. Recibe dos variables de entorno:

| Variable | Valor |
|---|---|
| `HIVE_AGENT_ID` | id del orquestador que lo invoca |
| `HIVE_AM_API` | `http://127.0.0.1:<puerto>` de la API |

Detalle en el [documento 9](09-orquestacion-y-relaciones.md).

### 3. Frontend: `web/app/layout.tsx` → `components/Shell.tsx`

`layout.tsx` es el componente raíz de Next (App Router). Envuelve todas las páginas en `<Shell>`, que monta:

- `HiveProvider` (`lib/store.tsx`): carga agentes, tipos, skills, colonias y proveedores, y abre el WebSocket.
- `Toaster` (notificaciones).
- La barra lateral de navegación.

Cada pantalla es una ruta de `web/app/`:

| Ruta | Archivo |
|---|---|
| `/` | `app/page.tsx` (Colony) |
| `/agents` | `app/agents/page.tsx` |
| `/agents/<id>` | `app/agents/[id]/page.tsx` |
| `/types` | `app/types/page.tsx` |
| `/skills` | `app/skills/page.tsx` |
| `/relations` | `app/relations/page.tsx` |
| `/sessions` | `app/sessions/page.tsx` |

## Puertos y variables de entorno

| Variable | Dónde se lee | Valor por defecto | Para qué sirve |
|---|---|---|---|
| `HIVE_AM_PORT` | `server/src/mcp-config.ts` | `4400` | Puerto del servidor (API + WebSocket). |
| `HIVE_AM_HOME` | `server/src/db.ts` | `~/.hive-am` | Carpeta de datos (base SQLite y configuraciones MCP). |
| `HIVE_AM_API` | `web/next.config.mjs` | `http://127.0.0.1:4400` | A dónde reenvía Next las llamadas `/api/*`. |
| `NEXT_PUBLIC_HIVE_WS_PORT` | `web/lib/store.tsx` | `4400` | Puerto al que se conecta el WebSocket del navegador. |
| `NEXT_DIST_DIR` | `web/next.config.mjs` | `.next` | Carpeta de salida de Next; permite correr una segunda instancia sin pisar la primera. |
| `HIVE_AGENT_ID`, `HIVE_AM_API` | `server/mcp/dispatch.mjs` | — | Las fija hive-am al lanzar el servidor MCP (no se configuran a mano). |

Puertos por defecto: **4400** (servidor) y **4401** (web).

### Correr una segunda instancia (pruebas)

Útil para probar sin tocar tus datos ni tu instancia en uso:

```bash
# servidor de prueba con base aislada (desde la raíz)
HIVE_AM_PORT=4410 HIVE_AM_HOME=/tmp/hive-prueba npm run start -w server

# web de prueba apuntando a ese servidor, con su propia carpeta de build (desde web/)
cd web
NEXT_DIST_DIR=.next-test HIVE_AM_API=http://127.0.0.1:4410 NEXT_PUBLIC_HIVE_WS_PORT=4410 \
  npx next dev -p 4411
```

## Qué se ejecuta cuando envías un mensaje

Resumen de procesos en juego:

```
navegador ──HTTP──▶ Next (4401) ──proxy──▶ servidor (4400)
                                              │
                                              ├─ spawn: claude | opencode | kiro-cli   (un proceso por turno)
                                              │        └─ (si orquestador) node mcp/dispatch.mjs  ──HTTP──▶ servidor (4400)
                                              └─ lectura de historial (archivos / SQLite del CLI)
```

Un orquestador que delega provoca, a su vez, otro `spawn` (el del subagente) dentro del mismo servidor.
