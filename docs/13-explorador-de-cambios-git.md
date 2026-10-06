# 13. Explorador de cambios (git)

En la pantalla de cada agente, junto a **Chat**, hay una pestaña **Cambios**. Es un **explorador de archivos** de la carpeta en la que trabaja el agente: muestra **todos** los archivos, resalta los que tienen cambios según git y, al seleccionar uno, muestra su **diferencia** o su contenido. **El código no se edita** desde ahí, pero sí se pueden hacer las acciones habituales de git (commit, pull, push, fetch, ramas) y consultar el **historial**; ver [13.8](#138-acciones-de-git-e-historial).

## 13.1 Qué se ve

```
┌ Chat | Cambios (9) ───────────────────────────────────────────────────────────────┐
│ ⎇ main  9320d97 initial commit · hace 10 min      9 archivos cambiados +8 −3  🔒 ⟳ │
├───────────────────────────┬───────────────────────────────────────────────────────┤
│ [Filtrar archivos…]       │ a.txt  [Modificado] [Sin stage] +3 −1                  │
│ [Todos | Con cambios · 9] │                      [Diferencias|Archivo] [Unificada|Lado a lado] │
│ ▾ dir                  1  │  1  1    uno                                           │
│     d.ts        +1 −1 R   │  2     − dos                                           │
│   .gitignore              │     2  + DOS CAMBIADO                                  │
│   a.txt         +3 −1 M ◀ │  …                                                     │
│   b.txt         +0 −1 D   │                                                        │
│   img.png             M   │                                                        │
│   new.txt       +2 −0 U   │                                                        │
└───────────────────────────┴───────────────────────────────────────────────────────┘
```

### Barra superior

| Elemento | Significado |
|---|---|
| `⎇ main  9320d97 ⌄` | **Badge de la rama**, compacto: rama (con puntos suspensivos si es muy larga) + hash corto + `↑n ↓n` si hay commits por delante / por detrás de la rama remota. Es un botón: al pulsarlo **se despliega el detalle** (ver abajo). Con la rama desacoplada muestra "desacoplado en `<sha>`"; sin commits, "sin commits aún" |
| `N archivos cambiados +A −D` | Resumen de cambios respecto al último commit |
| **Ramas · Fetch · Pull · Push · Commit** | Acciones de git ([13.8](#138-acciones-de-git-e-historial)) |
| ⟳ | Actualizar (el *tooltip* indica la hora de la última lectura) |

Si el agente trabaja en una **subcarpeta** del repositorio, todo se limita a esa subcarpeta y se muestra un aviso ("Mostrando solo `sub/`…").

**Detalle desplegable de la rama y del último commit.** Debajo de la barra, con texto completo y que se ajusta a varias líneas (así no se corta un nombre de rama o un mensaje largo): rama (con botón para copiarla), rama remota y su estado (al día / por delante y por detrás / sin rama remota), hash del último commit (con botón para copiarlo), **mensaje completo**, autor y cuándo. Se cierra volviendo a pulsar el badge.

### Árbol de archivos (izquierda)

- Muestra **todos los archivos que git conoce** en la carpeta del agente: los versionados más los nuevos sin versionar, **sin** los ignorados por `.gitignore` (por eso no aparece `node_modules`). Los archivos borrados siguen apareciendo, marcados.
- **Resaltado:** cada archivo con cambios lleva una barra de color a la izquierda, fondo tintado, su nombre en negrita, la letra de estado y, si se conoce, `+añadidas −eliminadas`. Las carpetas que contienen cambios tienen el icono en color y un contador.
- **Filtros:** cuadro de búsqueda por ruta (expande todas las ramas que coinciden) y el selector **Todos / Con cambios · N**.
- **Carpetas:** las cadenas de carpetas con un solo hijo se compactan (`src/components`). Al abrir, se despliegan las carpetas que llevan a algún cambio; si el árbol es pequeño (≤ 40 archivos), todas. Las carpetas que **aparecen con cambios nuevos** mientras el agente trabaja se abren solas.
- **Teclado:** `↑` `↓` mueven el foco, `→` `←` abren y cierran carpetas.
- El primer archivo con cambios se selecciona automáticamente.

### Estados

| Letra | Estado | Color | Cuándo |
|---|---|---|---|
| **M** | Modificado | ámbar | El archivo cambió |
| **A** | Añadido | verde | Nuevo y ya en el *stage* |
| **U** | Sin seguimiento | verde | Nuevo y todavía no añadido a git |
| **D** | Eliminado | rojo (tachado) | Borrado |
| **R** | Renombrado | azul | Movido/renombrado (incluso con ediciones) |
| **!** | Conflicto | rojo | Conflicto de *merge* |
| **T** | Tipo cambiado | violeta | Archivo ↔ enlace simbólico, etc. |

En la vista previa también se indica si el cambio está **En stage** y/o **Sin stage**. Las diferencias se calculan siempre contra el **último commit** (`HEAD`; si el repositorio aún no tiene commits, contra el árbol vacío): incluyen lo que está en el *stage* y lo que no.

### Vista previa (derecha)

| Caso | Qué muestra |
|---|---|
| Archivo con cambios de texto | Pestaña **Diferencias** (por defecto), en vista **Unificada** o **Lado a lado**, con números de línea y encabezados de bloque (`@@ -1,4 +1,5 @@`) |
| Archivo sin cambios | Pestaña **Archivo**: su contenido con números de línea |
| Pestaña **Archivo** de un archivo con cambios | Marcas de lo que cambió desde el último commit: **verde** las líneas agregadas, **azul** las modificadas (las que reemplazan a otras quitadas) y una **línea roja con una flecha** entre dos líneas donde se eliminaron líneas (al final del archivo, bajo la última línea). En un archivo **nuevo**, todo en verde. El margen de los números de línea lleva una barra del mismo color. **Pulsar una marca** (el número de línea, o la línea tintada sin estar seleccionando texto) abre justo debajo el **bloque de cambios**: un diff del bloque con sus líneas de contexto y, en la cabecera, un contador ("2 de 5") con dos flechas para ir al **cambio anterior** y al **siguiente** (también `Alt+↑` / `Alt+↓`): el archivo se desplaza solo hasta ese cambio y su bloque se abre. Las flechas se desactivan en el primero y en el último. Se cierra con la X o `Esc`. Pulsar de nuevo la misma marca lo cierra. Para que quede claro **qué bloque** es, las líneas que abarca (de su primera a su última línea cambiada, sin el contexto) se **sombrean en ámbar con una barra en el margen** y el título dice "Bloque de cambios · líneas 2–10"; el panel se coloca **debajo de la última línea del bloque** para no taparlo (si el bloque es muy largo, a más de ~25 líneas del punto donde pulsaste, se pone bajo la línea pulsada para que quede a la vista). El panel no mueve las filas: se dibuja encima de las siguientes y se desplaza con el archivo |
| Imagen (png, jpg, gif, webp, svg, ico, bmp, avif) | La imagen sobre un fondo de cuadros (también si fue modificada) |
| Archivo binario | Aviso "Archivo binario" (sin texto que mostrar) |
| Archivo eliminado | En **Archivo**, la versión del último commit con un aviso |
| Archivo renombrado | Aviso "Renombrado desde `ruta/vieja`" y el diff entre ambas |
| Archivo nuevo sin seguimiento | Todo el contenido como líneas añadidas |
| Cambio sin texto (p. ej. solo permisos) | "Sin diferencias de texto…" |

**Encabezados de bloque.** Cada bloque de un diff empieza con una fila separadora (`⋯ ⋯ @@ -20,9 +20,10 @@`) sin números de línea. Git le añade el texto de la línea más cercana encima del bloque que "parece" una función; solo se muestra, en gris cursiva, en archivos de **código** (en Markdown, YAML, JSON, INI, XML, Dockerfile y Makefile no significa nada y parecería una línea agregada, así que se oculta).

Además: botón **Copiar ruta**, aviso cuando el diff o el archivo se recortaron por tamaño. Los diffs y los archivos largos se desplazan sin límite de filas (ver [13.11](#1311-rendimiento-con-archivos-grandes)).

## 13.2 Cuándo se actualiza

| Momento | Qué se refresca |
|---|---|
| Al abrir la pantalla del agente | El **estado** (alimenta la insignia de la pestaña) |
| Al abrir la pestaña **Cambios** | Estado + árbol de archivos |
| Al terminar un turno del agente | Estado (y árbol si la pestaña está abierta) |
| **Cada 5 s** mientras el agente trabaja y la pestaña está abierta | Estado + árbol |
| Botón ⟳ | Todo |
| Cambiar la carpeta efectiva del agente | Se descarta lo cargado y se vuelve a leer |

El **chat sigue montado** (solo oculto) cuando estás en Cambios: un mensaje a medio escribir y la posición del scroll se conservan al volver.

## 13.3 Casos sin repositorio

| Situación | Mensaje |
|---|---|
| La carpeta no es un repositorio git | "Esta carpeta no es un repositorio git — ejecuta `git init` en `<ruta>` para ver aquí los cambios" |
| `git` no está instalado / no está en el `PATH` del servidor | "git no está disponible" |
| Otro error de git (p. ej. propiedad dudosa de la carpeta) | "No se pudo leer el repositorio" con el texto de git |

## 13.4 API de lectura

Todas bajo `/api/agents/:id/git/…`, y siempre sobre la **carpeta efectiva** del agente.

| Ruta | Respuesta |
|---|---|
| `GET …/git/status` | `{ isRepo, root, scope, branch, detached, head, upstream, changes[], truncated, generatedAt }` o `{ isRepo:false, reason, message, cwd }`. Cada cambio: `path, oldPath?, status, staged, unstaged, additions, deletions, binary` |
| `GET …/git/tree` | `{ isRepo, root, scope, files[], truncated }` (hasta 30 000 archivos) |
| `GET …/git/diff?path=<ruta>&old=<ruta vieja>` | `{ path, diff, truncated, binary }` — diff unificado (hasta 600 000 caracteres) |
| `GET …/git/file?path=<ruta>` | `{ path, size, binary, truncated, content, source: 'worktree' \| 'head' }` (hasta 1 MB) |
| `GET …/git/raw?path=<ruta>` | Los bytes de una **imagen** (hasta 8 MB) para el `<img>` de la vista previa |

Las rutas son **relativas a la raíz del repositorio**.

## 13.5 Seguridad

Las **lecturas** (explorador, diffs, historial) no escriben nada y están pensadas para no interferir con el agente; las **acciones** que escriben tienen sus propias reglas en [13.8](#138-acciones-de-git-e-historial). Sobre las lecturas:

- **No escribe nada** en el repositorio. Todas las llamadas son comandos de lectura (`status`, `diff`, `ls-files`, `show`, `rev-parse`, `log`, `rev-list`). `GIT_OPTIONAL_LOCKS=0` evita que `git status` toque el índice mientras el agente usa git.
- Se ejecuta con `execFile` (**sin shell**); las rutas siempre van después de `--`.
- **Las rutas se validan**: no pueden ser absolutas, contener `..` ni bytes nulos; deben quedar **dentro de la carpeta del agente**, comprobado también con la ruta real (un enlace simbólico que apunte fuera se rechaza). Cualquier ruta que incluya `.git` se rechaza (su `config` puede contener URLs con credenciales).
- Las cabeceras de los diffs de archivos nuevos se reescriben para **no exponer rutas absolutas**.
- Las imágenes se sirven con `X-Content-Type-Options: nosniff` y `Content-Security-Policy: sandbox`, de modo que un SVG nunca ejecuta scripts.
- Tiempo máximo por comando de git: 20 s; tamaños máximos descritos arriba.

Recuerda que, como el resto de la API, **no tiene autenticación** ([documento 12](12-operacion-y-problemas.md)).

## 13.6 Archivos

| Archivo | Responsabilidad |
|---|---|
| `server/src/git.ts` | Lectura: `gitStatus`, `gitTree`, `gitDiff`, `gitFile`, `gitImagePath`; validación de rutas |
| `server/src/api.ts` | Las rutas `…/git/*` (la de `raw` escribe su propia respuesta binaria) |
| `web/lib/useGit.ts` | Hook: estado, árbol, refresco y *polling* |
| `web/lib/gitTree.ts` | Construye el árbol, compacta carpetas, filtra y aplana filas |
| `web/lib/diff.ts` | Parser de diff unificado y emparejado para la vista lado a lado |
| `web/components/GitExplorer.tsx` | Barra, árbol, vista previa y vista de un commit |
| `web/components/ConflictResolver.tsx` · `web/lib/conflicts.ts` | Resolvedor de conflictos y el análisis/aplicación de bloques |
| `web/components/CodeEditor.tsx` · `Code.tsx` · `GitSettings.tsx` · `web/lib/highlight.ts` · `web/lib/gitPrefs.ts` | Editor con resaltado, código resaltado, ajustes de vista, resaltador y preferencias |
| `web/components/StatusLetter.tsx` · `web/lib/useDismiss.ts` | Piezas compartidas: la letra de estado (M/A/D/R/U/!/T) y el cierre de popovers con clic fuera o Esc (también lo usa `HelpPopover`) |
| `web/components/useAgentSettings.tsx` · `DeleteAgentModal.tsx` | Edición y borrado de un agente, compartidos por el chat y Colonia |
| `web/components/GitActions.tsx` | Botones Fetch/Pull/Push/Commit, menú de ramas, diálogo de commit, lista del historial |
| `server/src/gitops.ts` | Historial, ramas y acciones que escriben (commit, pull, push, fetch, switch, merge) |
| `web/app/agents/[id]/page.tsx` | Pestañas **Chat / Cambios** y la insignia |

## 13.7 Límites conocidos

- Muestra diferencias contra `HEAD`: no separa visualmente lo que está en el *stage* de lo que no (solo lo indica con una etiqueta). El commit elige archivos completos, no líneas sueltas.
- Sin resaltado de sintaxis ni diferencias a nivel de palabra.
- Los renombres se detectan con la heurística de similitud de git (`-M`).
- Sin *stash*, *cherry-pick* ni *rebase* interactivo; no hace *force push*. Se puede descartar un archivo, un bloque o **líneas sueltas** dentro de un bloque (solo en la vista Unificada).
- En repositorios enormes el árbol se recorta a 30 000 archivos y la lista visible a 2 000 filas (se avisa; el filtro permite llegar al resto).
- Los submódulos aparecen como una sola entrada.

## 13.8 Acciones de git e historial

Junto al resumen de cambios, la barra ofrece **Ramas**, **Fetch**, **Pull**, **Push** y **Commit**. Pull y Push muestran un contador (`↓n` / `↑n`) con los commits por traer o por enviar; Commit muestra cuántos archivos tienen cambios. Mientras una acción corre, los botones se desactivan y el icono gira. Al terminar aparece un aviso (con la última línea que imprimió git) y el estado se refresca.

| Acción | Qué hace | Detalles |
|---|---|---|
| **Commit** | Abre un diálogo con los archivos cambiados (todos marcados), un cuadro de mensaje y los botones **Commit** y **Commit y push** (`Ctrl+Enter` confirma) | Solo se confirma lo **marcado**: `git add -A -- <rutas>` y `git commit -m <mensaje> -- <rutas>` (en el primer commit del repositorio, lo que se acaba de añadir). Los renombres incluyen la ruta vieja. Se ejecutan los *hooks* del repositorio. Con una **fusión en curso** (p. ej. tras resolver un conflicto) git no admite commits parciales, así que se confirma todo lo que esté en el *stage*. |
| **Fetch** | `git fetch --all --prune` | No toca tus archivos |
| **Pull** | `git pull --ff-only --no-edit` | Solo avance rápido. Si las ramas **divergieron**, el aviso ofrece **Pull con merge** y **Pull con rebase** |
| **Push** | `git push`; si la rama aún no tiene *upstream*, `git push -u origin <rama>` | Nunca `--force`. Desactivado con la rama desacoplada |
| **Ramas** | Menú con búsqueda, ramas **locales** y **remotas**, y un campo para **crear** una rama nueva desde la actual | Clic en una rama = cambio de rama, **inteligente si hace falta** ([13.13](#1313-cambio-inteligente-de-rama-y-stashes)); una remota se convierte en rama local que la sigue. El icono de fusión pide confirmación y ejecuta `git merge --no-edit <rama>` |
| **Cancelar fusión** | `git merge --abort` | Aparece en el aviso cuando una fusión (o pull con merge) termina con **conflictos** |

Si git falla (conflictos, credenciales, cambios locales que impiden cambiar de rama…), se muestra **el texto de git tal cual** en un aviso rojo que se cierra con la X.

**Agente trabajando.** Si el agente está en un turno, aparece una advertencia ("…hacer commit, pull o cambiar de rama ahora puede chocar con sus ediciones"). Las acciones **no se bloquean**: la decisión es tuya.

### Historial

La pestaña **Historial** (junto a *Archivos*) lista los commits de la rama actual, **30 por página** con **Cargar más**: asunto, hash corto, autor, fecha relativa y etiquetas de ramas (`merge` si es un commit de fusión). Se recarga sola cuando `HEAD` cambia. Al elegir un commit se ve su mensaje completo, autor, fecha, la lista de archivos con `+/−` y el diff de cada uno (unificado o lado a lado). Para un commit de **fusión** se muestran los cambios respecto a su primer padre (lo que trajo la fusión). Es ligero: solo se pide una página de commits y, bajo demanda, el diff de **un** archivo.

### API (escritura e historial)

| Ruta | Descripción |
|---|---|
| `GET …/git/log?skip=N` | `{ commits[], hasMore }` (30 por página) |
| `GET …/git/commit?sha=` | Detalle de un commit: mensaje, autor, fecha, archivos (hasta 500) |
| `GET …/git/commit-diff?sha=&path=&old=` | Diff de un archivo en ese commit |
| `GET …/git/branches` | `{ current, local[], remote[] }` |
| `POST …/git/commit` | `{ message, paths[] }` |
| `POST …/git/fetch` · `…/pull` (`{ mode: 'ff-only' \| 'merge' \| 'rebase' }`) · `…/push` | |
| `POST …/git/switch` | `{ branch, create? }` |
| `POST …/git/merge` · `…/merge-abort` | `{ branch }` / sin cuerpo |

Las acciones responden `{ ok: true, output }`; si git falla, `400` con `{ error }` (el texto de git).

### Seguridad de las acciones

- **Sin shell:** `execFile`; el mensaje va como valor de `-m`, las rutas después de `--`, y los nombres de rama se validan con `git check-ref-format` (y no pueden empezar con `-`). Las rutas pasan por la misma validación que las lecturas (dentro de la carpeta del agente, nunca `.git`).
- **Nunca `--force`**, nunca `--no-verify`, y `GIT_TERMINAL_PROMPT=0` + `ssh -o BatchMode=yes`: si faltan credenciales, git falla en vez de quedarse esperando.
- **Origen local:** como la API acepta cualquier origen (CORS abierto), las rutas de escritura rechazan (`403`) las peticiones con cabecera `Origin` que no sea `localhost`/`127.0.0.1` o el mismo host. Una página web externa no puede lanzar un commit o un push.
- **Una escritura a la vez por repositorio:** un cerrojo en el servidor evita choques por doble clic o dos pestañas (`index.lock`).
- Tiempos máximos: 30 s las acciones locales y 120 s las de red.

## 13.9 Resolver conflictos

Cuando una fusión (o un *pull* con merge o rebase) deja conflictos, aparece una franja **"Fusión en curso"** (o **"Rebase en curso"**) con el número de archivos en conflicto y los botones **Cancelar fusión** (`merge --abort`, o `rebase --abort` si es un rebase). Los archivos en conflicto llevan la letra **!** y, al seleccionarlos, la vista previa es el **resolvedor**:

- **Un bloque por conflicto**, con dos columnas: **Mío (rama actual)** y **Remoto (lo que entra)**, con el nombre de la rama de cada lado. Cada bloque ofrece **Quedarme con lo mío**, **Quedarme con el remoto** y **Quedarme con ambos** (**mío primero** o **remoto primero**). Se pueden mezclar decisiones: el bloque 1 mío, el 2 del remoto, el 3 ambos.
- **Resultado editable.** Abajo está el archivo completo, siempre editable (con números de línea, el mismo resaltado y los mismos temas del visor). Cada botón de bloque solo reescribe su bloque en ese texto; cualquier cosa se puede corregir a mano (por ejemplo si "ambos" deja código repetido). **No hay detección automática de repetidos**: dos funciones con el mismo nombre pueden estar estructuradas distinto y quitarlas sin que lo decidas sería peligroso. Las líneas de marcadores (`<<<<<<<`, `=======`, `>>>>>>>`) se pintan en otro color.
- **Todo lo mío / Todo lo del remoto** (`git checkout --ours|--theirs`): toman un lado completo del archivo; si ese lado lo había borrado, el archivo se elimina. Es la única opción para archivos binarios o demasiado grandes.
- **Marcar como resuelto:** guarda el resultado y hace `git add`. Se rechaza si aún quedan marcadores `<<<<<<<` / `>>>>>>>`.
- **Restaurar conflicto:** `git checkout -m -- <archivo>` vuelve a poner los marcadores.
- En un **rebase** git invierte los lados: el resolvedor lo tiene en cuenta ("mío" siempre es el lado con tus commits).
- Con todos los conflictos resueltos, la franja muestra **Concluir fusión (commit)** (el mensaje viene prellenado con el de git) o **Continuar rebase** (`git rebase --continue`).

API: `POST …/git/resolve-side` `{ path, side: 'ours'|'theirs' }`, `…/resolve` `{ path, content }`, `…/unresolve` `{ path }`, `…/rebase-continue`. Solo se aceptan sobre archivos que git tiene realmente en conflicto, con las mismas validaciones de ruta y de origen que el resto de acciones. El estado (`state: 'merge'|'rebase'|null`, `mergeMsg`) viene en `GET …/git/status`.

## 13.10 Ajustes de la vista de código y blame

**Ajustes** (icono de sliders en la barra, se guardan solo en este navegador: `localStorage` `hive-git-view`):

| Ajuste | Efecto |
|---|---|
| **Tema** | Hive (sigue a la app), GitLab Light, GitLab Dark, Solarized Light/Dark, Monokai, Dracula. Cambia el fondo, los números de línea, los colores de añadido/eliminado y la sintaxis |
| **Mostrar espacios en blanco** | Espacios como `·` y tabuladores como `→`. El carácter real se conserva (los anchos no cambian); el marcador se dibuja encima con CSS |
| **Ancho del tabulador** | 2, 4 u 8 |

Los ajustes se aplican por igual al **visor de archivos**, a los **diffs** (unificado y lado a lado, también en el historial), a los bloques del resolvedor y al **editor del resultado**, que es un `<textarea>` transparente sobre una capa resaltada (mismo tipo de letra y *scroll*), así que se ve idéntico al visor y conserva el cursor y la selección nativos.

**Resaltado:** `highlight.js` (núcleo + 26 lenguajes, cargados con el resto del código) en `web/lib/highlight.ts`; el lenguaje sale de la extensión (o `Dockerfile`/`Makefile`). Cada línea de un diff se resalta por separado. Por encima de 250 000 caracteres no se resalta.

**Blame:** en la pestaña **Archivo** de un archivo versionado, el botón **Blame** añade una columna con el hash corto, el autor y el tiempo relativo en la primera línea de cada tramo del mismo commit (los tramos alternan de tono). Pasar el cursor muestra el asunto del commit y la fecha; al hacer clic se abre ese commit en **Historial**. Las líneas sin commit dicen "Sin commit". Hasta 5 000 líneas (se avisa). `GET …/git/blame?path=` devuelve `{ commits, lines[] (un hash por línea), truncated }` (`git blame --porcelain -w`).

**Fechas.** En todo el visor (blame, historial, detalle de un commit, información de la rama) las fechas se muestran con diagonales y en orden **día / mes / año** (`06/10/2026, 10:46`), nunca con el mes primero, y con hora de 24 h, en español y en inglés. El servidor entrega las fechas en ISO 8601 y la interfaz las formatea según el idioma (`dateLocale()` en `web/lib/i18n/core.ts`, `fmtDate`/`fmtDateTime` en `web/lib/format.ts`). Los tiempos relativos ("hace 5 min") usan el mismo `ago()` que el resto de la app.

## 13.11 Rendimiento con archivos grandes

Un archivo de miles de líneas (p. ej. un `.pm` de 2 200 líneas / 80 KB) no debe trabar la interfaz. Por eso:

- **Filas virtualizadas** (`web/components/VirtualLines.tsx`): el visor de archivos y el editor del resolvedor solo ponen en el DOM las filas visibles más un margen (~50 en total), con altura fija de 20 px y sin ajuste de línea. Abrir un archivo de 2 185 líneas pasó de ~2 200 filas de tabla a ~56 filas. Los **diffs** (unificado y lado a lado, también en el historial) funcionan igual: un diff de ~2 900 filas pone ~60 en el DOM. Ya no existe el límite de 2 000 filas ni el botón "Mostrar todas".
- **Resaltado fuera del hilo principal** (`web/lib/useHighlighted.ts`, `highlight.worker.ts`): hasta 15 000 caracteres se resalta al instante; por encima, lo hace un *Web Worker*. Mientras el worker trabaja (y mientras editas), cada línea que no cambió conserva sus colores —se compara desde el principio y desde el final del archivo— y solo las líneas editadas se ven sin color un instante. En el editor, el resaltado espera 150 ms de calma.
- **Filas baratas:** cada fila recibe la preferencia de "mostrar espacios" ya resuelta (`CodeCell`, sin suscribirse por fila) y los diffs usan filas memorizadas.
- **Límite de resaltado:** 1,2 M de caracteres (más que cualquier archivo que el servidor envía, 1 MB).

Medido en modo desarrollo con ese archivo: desplazarse por 30 000 px promedia ~23 ms por fotograma; en el editor, cada pulsación pasó de ~350 ms a ~95 ms, de los cuales ~65 ms son del propio `<textarea>` del navegador con 83 KB de texto (un `<textarea>` simple de ese tamaño tarda ~33 ms en actualizar su valor y recalcular el diseño). En una compilación de producción es menor.

**Lado a lado con líneas largas.** Para poder virtualizar, las filas no se parten en varias líneas: en la vista **Unificada** las líneas largas se recorren con la barra horizontal; en **Lado a lado** cada mitad ocupa exactamente la mitad de la pantalla y una línea más larga se corta con «…» (el texto completo aparece al pasar el cursor, y la vista unificada la muestra entera).

## 13.12 Descartar cambios

Tres niveles, siempre contra el **último commit** (`HEAD`):

| Dónde | Qué descarta | Cómo |
|---|---|---|
| Botón **Descartar** en la cabecera del archivo | Todos los cambios de ese archivo | Modificado / borrado / cambio de tipo: `git restore --source=HEAD --staged --worktree`. Renombrado: restaura el nombre original y quita el nuevo. Nuevo sin versionar: lo **elimina** (`git clean -f`). Nuevo ya en el *stage*: lo **elimina** (`git rm -f`) |
| Botón **Descartar bloque** en el encabezado de cada bloque del diff (solo archivos modificados) | Solo ese bloque | El servidor vuelve a calcular el diff contra `HEAD`, toma el bloque N y lo aplica **al revés** (`git apply -R --index`, y si el *stage* no coincide, solo el árbol de trabajo). Si el encabezado `@@ -a,b +c,d @@` ya no coincide con el bloque N (el archivo cambió desde que se dibujó) se rechaza con "The file changed since it was shown" |
| Icono de deshacer en la barra | Todo lo que hay cambiado en la carpeta del agente | `git restore --source=HEAD --staged --worktree` y `git clean -f -d`. Pide confirmación (ver abajo). Desactivado con una fusión o rebase en curso |

**Líneas sueltas.** En el encabezado de cada bloque, **Elegir líneas** (solo vista Unificada, archivos modificados) pone una casilla en cada línea `+` o `−` del bloque; se marcan con la casilla o haciendo clic en la fila. El encabezado pasa a **Todas · Descartar N líneas · Cancelar**. Al descartar, el servidor arma un parche con solo lo marcado: una línea agregada **no** marcada se convierte en contexto (se queda) y una línea quitada **no** marcada se omite del parche (sigue quitada); luego aplica ese parche al revés (`git apply -R --index`, o solo al árbol de trabajo). Ejemplo: en un bloque con `−l4 −l5 −l6 +L5 +L6 +NEW1 +NEW2`, marcar `l4`, `NEW1` y `NEW2` recupera `l4` y quita las dos líneas nuevas, y deja el reemplazo `l5, l6 → L5, L6` tal cual. La posición de cada línea se cuenta entre las líneas **cambiadas** del bloque (desde 0) y el encabezado `@@` se verifica igual que al descartar un bloque.

**Qué pide confirmación.** (1) **Descartar todo** (ícono de deshacer de la barra) **siempre** pregunta, porque es lo único que puede tirar mucho trabajo de un clic. El modal "¿Descartar todos los cambios?" dice con números cuántos archivos con cambios vuelven al último commit, y —en un recuadro rojo— cuántos **archivos nuevos se ELIMINARÁN por completo** (con su lista, hasta 8 y "+N más"), el total de líneas (`+A −D`) y que "todo esto se pierde de forma definitiva". (2) Descartar **un archivo** también **siempre** pregunta: si es nuevo, "¿Eliminar archivos por completo?"; si no, "¿Descartar los cambios de este archivo?", que dice qué pasará según el caso (vuelve al último commit con sus `+A −D` líneas, se restaura el archivo borrado o se deshace el renombrado) y que no se puede deshacer. (3) Un **bloque** o **líneas sueltas** se ejecutan **al instante**. No hay copia de respaldo en ningún caso.

Los archivos en **conflicto** no se pueden descartar: se resuelven con el resolvedor o se cancela la fusión ([13.9](#139-resolver-conflictos)).

API: `POST …/git/discard` `{ path, oldPath? }`, `…/discard-hunk` `{ path, index, header }`, `…/discard-lines` `{ path, index, header, lines[] }`, `…/discard-all`. Mismas validaciones de ruta y de origen que el resto de acciones.

**Medido con archivos grandes** (modo desarrollo; archivo de 2 193 líneas / 83 KB con ~730 líneas modificadas):

| Caso | Resultado |
|---|---|
| Un solo bloque de ~1 456 líneas cambiadas: elegir líneas, "Todas", alternar una | 17–28 ms por acción |
| Descartar 1 455 de esas 1 456 líneas (cliente + servidor + refresco) | ~134 ms |
| 145 bloques pequeños: desplazarse / descartar un bloque | ~4 ms por paso / ~111 ms |
| Archivo de 2,2 MB con un diff de 3,7 MB | abre en ~0,5 s, ~55 filas en el DOM |
| Vista de archivo de 2,2 MB | abre en ~0,8 s, desplazamiento ~4 ms por paso |

**Límites con archivos enormes:**
- **Diff:** el servidor corta el diff a 600 000 caracteres y la interfaz avisa ("el diff era demasiado grande y se muestra solo en parte"). Como el último bloque puede quedar incompleto, en ese caso se **ocultan** sus botones de descartar bloque / elegir líneas (descartar sobre un bloque cortado aplicaría el bloque real completo, no lo visible). Los demás bloques y el botón **Descartar** del archivo siguen disponibles.
- **Vista de archivo:** se muestra solo el primer 1 MB ("Archivo grande: se muestra solo la primera parte").
- **Blame:** hasta 5 000 líneas.
- **Resaltado:** archivos de más de 15 000 caracteres se resaltan en un worker; por encima de 1,2 M de caracteres no se resaltan.

## 13.13 Cambio inteligente de rama y stashes

### Cambiar de rama sin perder lo que tienes sin commit

El cambio es **directo, sin diálogo** (como el *smart checkout* de JetBrains). `git switch` ya lleva tus cambios a la otra rama cuando ninguno de los archivos que modificaste es distinto entre las dos; cuando algo choca, hive-am hace el trabajo por ti. Al hacer clic en una rama, el servidor calcula un **plan** (`GET …/git/switch-plan?branch=`): cuántos cambios viajan, qué archivos tuyos son también distintos en la rama destino (`overlap`), qué archivos **nuevos** tuyos ya existen allí (`collisions`) y qué **otros agentes están trabajando ahora mismo en el mismo repositorio**.

- **Nada choca:** `git switch` normal. Aviso: "Ahora en X; N cambios vinieron contigo".
- **Algo choca (`overlap` o `collisions`):** **cambio inteligente** automático (abajo). Aviso igual, y si un conflicto necesita resolverse lo dice ("— resuelve los conflictos") y aparece la franja.
- **Archivo nuevo tuyo que ya existe en la otra rama:** no se pregunta nada: **se queda tu versión**, como una **modificación** de ese archivo (el aviso lo dice: "`n.txt` ya existía allí: se quedó tu versión"). La otra versión está a un "Descartar" de distancia, y el diff contra ella se ve en el propio archivo.
- **Lo único que pregunta:** si hay **otro agente trabajando ahora mismo** en el repositorio (o este mismo agente está en un turno), un aviso corto —"…cambiar de rama modifica los archivos que está editando"— con **Cambiar de todos modos**. Se cuentan los agentes que comparten **repositorio**, aunque trabajen en subcarpetas distintas.
- No existe un "forzar cambio": para tirar todos los cambios está **Descartar todos los cambios**, con su modal explícito.

**Cambio inteligente** (`POST …/git/switch-smart` `{ branch }`): (1) `git stash push -u -m "hive-am smart switch: A -> B"` (incluye archivos nuevos); (2) `git switch B` (si falla, se reaplica el stash y se devuelve el error); (3) quita de la rama destino las copias de los archivos que chocan para que git pueda restaurar los tuyos; (4) `git stash pop`. Un conflicto al reaplicar **no es un error**: los archivos quedan con marcadores, el stash se conserva y aparece la franja **"Cambio inteligente en curso A → B"**.

- **Resolver:** con el resolvedor de siempre (aquí "Mío" son tus cambios guardados y "Rama destino" la otra). Con todo resuelto, **Terminar** quita el *stage* (un stash reaplicado no queda en stage) y borra el stash (`POST …/git/smart-finish`).
- **Cancelar cambio inteligente** (`…/smart-cancel`, con confirmación): borra los archivos nuevos que el reaplicado ya restauró, `git reset --hard`, vuelve a la rama original y reaplica el stash: tus cambios quedan **exactamente como estaban**. Lo que editaste mientras resolvías se pierde.
- Si algo falla a la mitad el stash se conserva y el mensaje dice dónde está (por eso lleva un nombre claro).

### Gestor de stashes

Pestaña **Stashes · N** (junto a Archivos e Historial). Lista cada stash (mensaje, rama, cuándo; los de un cambio inteligente llevan la etiqueta "cambio inteligente") y a la derecha muestra sus archivos —también los **nuevos**— con el diff. Botones: **Guardar cambios en un stash** (con mensaje opcional; incluye archivos nuevos y deja el árbol limpio), **Aplicar** (conserva el stash), **Aplicar y borrar** y **Borrar** (con confirmación explícita). Un conflicto al aplicar se resuelve con el resolvedor. Cada operación recibe el hash del stash (no su posición) y se rechaza si ya no existe.

API: `GET …/git/stashes`, `…/git/stash?sha=`; `POST …/git/switch-smart`, `…/smart-finish`, `…/smart-cancel`, `…/stash-save`, `…/stash-apply` `{ sha, pop }`, `…/stash-drop`. Estado en `GET …/git/status`: `state: 'stash'` y `stash: { ref, sha, from, to }`. Las mismas protecciones de siempre (rutas dentro de la carpeta, origen local, una escritura a la vez).

**Límites:** un stash reaplicado no conserva el *stage* (queda todo sin stage); el aviso de agentes cuenta solo los que están **trabajando** en ese momento y comparten repositorio; los archivos ignorados por `.gitignore` no viajan con el stash.

**Qué cuenta como "un cambio" al recorrerlos.** git agrupa en un mismo bloque (*hunk*) los cambios que están a menos de 7 líneas, así que un archivo con 23 tramos de líneas cambiadas puede salir como 4 bloques. Los editores (VS Code, JetBrains) recorren los cambios individuales, y el visor hace lo mismo: un **cambio** es un tramo de líneas agregadas/quitadas, y dos tramos solo se unen cuando entre ellos hay únicamente **líneas en blanco** (en VS Code se unen igual). Ejemplo medido: un archivo de Go con 23 tramos y 4 bloques de git sale con **13** cambios (VS Code muestra 12; su algoritmo de diff es otro y puede alinear distinto algunas líneas). El panel muestra cada cambio con 3 líneas de contexto, no el bloque entero de git, y su título indica las líneas exactas.

