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

### Desde npm

Sin clonar el repositorio: `npx hive-am` (o `npm install -g hive-am` y luego `hive-am`); también corre en segundo plano con `hive-am start --background` (ver [El launcher](#el-launcher-hive-am)). Arranca el servidor de la API (puerto 4400) y la interfaz (puerto 4401, se cambia con `HIVE_AM_WEB_PORT`) desde el paquete publicado. El puerto de la API es fijo en el paquete. Ver [Publicar una versión](#publicar-una-versión).

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

1. Se importa `db.ts`: abre (o crea) `~/.hive-am/hive-am.db`, ejecuta las **migraciones de esquema** pendientes (`db/migrations.ts`, versionadas con `PRAGMA user_version`; ver el [documento 4](04-almacenamiento.md)) y **normaliza el estado tras un apagón** (ver abajo).
2. `skills.seedDefaults()` crea, una sola vez cada una, las skills que vienen con hive-am; después `seedIfEmpty()` crea el kit inicial solo si no hay tipos, agentes ni skills propias.
3. Se crea un `http.createServer` cuyo handler es `handle()` de `api.ts`.
4. Se monta un `WebSocketServer` en la ruta `/ws` sobre el mismo servidor HTTP.
5. Cada conexión WebSocket se suscribe al `bus` del runtime y reenvía cada mensaje como JSON; al cerrarse se desuscribe.
6. `server.listen(API_PORT, '127.0.0.1')` y escribe en consola `hive-am server → http://127.0.0.1:4400`. Si el puerto está ocupado lo dice con claridad (`is hive-am already running? (HIVE_AM_PORT changes it)`) y sale con código 1.

`api.ts` es solo una fachada (unas 50 líneas, exporta `handle`): las rutas viven en `http/routes/*.ts`, un archivo por dominio, sobre `http/router.ts`; ver [5.2](05-comunicacion-back-front.md#52-convenciones-de-la-api-rest).

**Cierre ordenado** (final de `index.ts`). Con `SIGINT` o `SIGTERM` el servidor deja de aceptar peticiones y corta los sockets, cierra los WebSockets, termina las terminales, detiene las conexiones de canales y cierra la base de datos (que fusiona su registro de escritura), y sale con 0. Si un paso se cuelga, sale igualmente a los **5 segundos**. **No** detiene los servidores y contenedores que se mantienen como recursos (sobreviven a hive-am por diseño) ni los turnos en curso de los agentes. Errores sueltos: un `unhandledRejection` se registra y el servidor sigue atendiendo (guarda terminales y turnos en curso); un `uncaughtException` se registra y el servidor se cierra con código 1.

**Recuperación tras un apagón** (al final de `db.ts`, se ejecuta en cada arranque):

```sql
UPDATE agents     SET status='idle'         WHERE status='running';
UPDATE dispatches SET status='interrupted', finished_at=<ahora>  WHERE status IN ('queued','running');
```

El turno que estaba en vuelo se pierde, pero la sesión nativa está intacta y el agente queda libre. Después `armDispatchNotices()` (`dispatches.ts`, junto a `armWakeups()` en `index.ts`) le avisa a cada orquestador de sus tareas en segundo plano que terminaron sin avisarse, incluidas las interrumpidas ([9.3](09-orquestacion-y-relaciones.md#93-flujo-de-una-delegación)).

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
| `NEXT_PUBLIC_HIVE_WS_PORT` | `web/lib/store.tsx` | `4400` | Puerto al que se conecta el WebSocket del navegador (`wss:` si la página se sirve por https). |
| `HIVE_AM_KILL_GRACE_MS` | `server/src/providers/spawn.ts` | `5000` | Cuánto tiempo tiene un CLI al que se pidió parar (SIGTERM) antes de matarlo con SIGKILL. |
| `HIVE_AM_TELEGRAM_TIMEOUT_MS` | `server/src/connections/telegram.ts` | `30000` | Tiempo límite de cada llamada, subida y descarga de la API de Telegram. |
| `HIVE_AM_WAKE_RETRY_MS` | `server/src/wake.ts` | `5000` | Espera antes de reintentar la entrega de un despertador que falló (12 intentos, luego se descarta). |
| `NEXT_DIST_DIR` | `web/next.config.mjs` | `.next` | Carpeta de salida de Next; permite correr una segunda instancia sin pisar la primera. |
| `HIVE_AM_DISPATCH_POLL_S` | `server/mcp/dispatch.mjs` | `25` | Cuánto espera cada llamada a `dispatch_status` de un `dispatch` síncrono (1 a 60 s). Las pruebas lo acortan. |
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

## Publicar una versión

El repositorio tiene un `Makefile` con las dos tareas de publicación (`make help` las lista):

**1) Release: pedir los cambios, subir versión, actualizar el changelog, commit, tag y push**

```bash
make changelog-add TYPE=Added MSG="Lo que agregaste"   # en cualquier momento: deja una entrada en "Sin publicar"
make release-preview BUMP=minor     # muestra la versión nueva y la entrada del changelog, sin cambiar nada
make release BUMP=minor             # patch (por defecto) | minor | major | una versión exacta como BUMP=1.0.0
```

`CHANGELOG.md` sigue [Keep a Changelog 1.1.0](https://keepachangelog.com/es-ES/1.1.0/): arriba la sección "Sin publicar", después una sección por versión, con los cambios agrupados en **Añadido, Cambiado, Obsoleto, Eliminado, Corregido** y **Seguridad**, y los enlaces de comparación al final. Se escribe en inglés; si los títulos del archivo están en español, se mantiene en español.

`make release` (ejecuta `scripts/release.mjs`) exige el árbol limpio en `main` y todo subido, y hace en orden:

1. **Pide los cambios.** Si "Sin publicar" ya tiene entradas las muestra y pregunta si quieres agregar más; si está vacía, lista los commits desde el último tag como referencia y pide las entradas tipo por tipo (una por línea; una línea vacía pasa al siguiente tipo). Sin terminal y sin entradas se detiene en lugar de publicar una versión vacía.
2. Muestra la sección nueva y pide confirmación (`YES=1` omite las preguntas).
3. Comprueba los tipos, sube `version` en los paquetes raíz, `server` y `web` (y en `package-lock.json`) y mueve las entradas de "Sin publicar" a la versión nueva con la fecha de hoy.
4. Hace el commit `release vX.Y.Z`, crea el tag anotado `vX.Y.Z` y sube la rama **y el tag**. `PUSH=0` hace el commit y el tag sin subirlos; `ALLOW_BRANCH=1` permite publicar desde otra rama.

**2) Publicar en npm**

```bash
npm login                           # una vez
make npm-pack                       # construye dist/npm y lista lo que se publicaría
make npm-publish                    # construye y publica (NPM_TAG=next para una etiqueta de prueba)
```

`make npm-build` arma el paquete en `dist/npm` (ignorado por git): el servidor compilado a JavaScript (`server/dist`), el script MCP, la interfaz web ya construida (`web/.next`), el lanzador `hive-am` (`bin/hive-am.mjs`) y un `package.json` con solo las dependencias de ejecución. `make npm-publish` antes comprueba que hayas iniciado sesión en npm, que esa versión no esté ya publicada y que `HEAD` sea el tag `vX.Y.Z` con el árbol limpio (`FORCE=1` omite lo último).

Ya publicado, `npx hive-am` (o `npm install -g hive-am` y `hive-am`) arranca el servidor y la interfaz. **Limitación de la versión empaquetada:** la API usa siempre el puerto 4400 (la interfaz está construida para hablar con él); solo se puede cambiar el de la interfaz, con `HIVE_AM_WEB_PORT`.

### El launcher (`hive-am`)

`bin/hive-am.mjs` es el punto de entrada del paquete. `hive-am` a secas (o `hive-am start`) corre la aplicación en la terminal, como siempre. Además recuerda la ejecución y ofrece:

| Comando | Qué hace | Salida |
|---|---|---|
| `hive-am start --background` | Se lanza a sí mismo de nuevo, desacoplado y en su propio grupo de procesos, con la salida de los dos procesos en `run/hive-am.log`, y vuelve cuando la ejecución ya quedó registrada. Cerrar la terminal no lo detiene. | 0, o 1 si no arrancó |
| `hive-am status` | `running (pid, desde, modo)` con si los puertos web y API responden; `not running`; o un registro obsoleto. | 0 corriendo, 1 no |
| `hive-am logs [-f] [-n 200]` | Las últimas líneas del log, o lo mismo siguiéndolo. Una ejecución en primer plano no tiene archivo de log y lo dice. | 0 |
| `hive-am stop` | Señala al launcher, que detiene el servidor y la web y los espera (el servidor cierra su base de datos al salir); a los 15 s fuerza el grupo. | 0 detenido, 1 nada que detener |
| `hive-am restart` | `stop` y luego `start` en el mismo modo (en segundo plano si no había nada registrado). | 0 |
| `hive-am update [--check] [--restart]` | Pregunta a npm (`npm view hive-am version`) por la última versión y, si es más nueva, ejecuta `npm install -g hive-am@<esa versión>`. `--check` solo informa. Si hay una ejecución en marcha avisa que sigue en la versión vieja, y `--restart` la reinicia con los archivos nuevos. Solo instala cuando esta copia se instaló globalmente con npm: con `npx` indica `npx hive-am@latest`, y en un checkout del código fuente indica `git pull`. | 0, 1 si no puede actualizar |
| `hive-am version` | Imprime la versión (también `--version`). | 0 |

Cada ejecución abre con una bienvenida (la versión, las direcciones web y API, la carpeta de datos y cómo detenerla), que es lo primero en el log de una ejecución en segundo plano, y su registro guarda la versión, que `status` muestra.

Lo que guarda está en `<HIVE_AM_HOME>/run/`: `hive-am.json` (pid, hora de inicio del proceso, modo, puertos y ruta del log; lo escriben ambos modos y se borra cuando la aplicación se detiene) y `hive-am.log`, que pasa a `hive-am.log.1` al superar 10 MB cuando el launcher arranca y cada minuto mientras corre en segundo plano (unas pocas líneas escritas durante la rotación pueden perderse). El pid nunca se cree solo: cada comando revisa la hora de inicio, un registro cuyo proceso ya no existe o ahora es de otro se informa como obsoleto y nunca se le envía una señal, y un segundo `start` se niega y nombra al que está corriendo (también se niega si otra cosa ocupa un puerto). El launcher no importa nada del servidor, así que funciona con la aplicación caída y la carpeta de datos sin crear. Las terminales siguen terminando con la aplicación; los recursos y contenedores siguen sobreviviéndola.

Variables solo para pruebas, que lee el launcher: `HIVE_AM_LAUNCHER_CHILDREN` (reemplaza los dos procesos por `[[comando, ...args], [comando, ...args]]`) `HIVE_AM_LAUNCHER_API_PORT` (el puerto de la API que revisa e imprime; la interfaz empaquetada siempre usa 4400), `HIVE_AM_NPM` (el programa npm que ejecuta `update`) y `HIVE_AM_LAUNCHER_INSTALL` (fuerza cómo cuenta esta copia como instalada: `global`, `npx`, `source`).
