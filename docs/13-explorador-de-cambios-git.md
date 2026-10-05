# 13. Explorador de cambios (git)

En la pantalla de cada agente, junto a **Chat**, hay una pestaña **Cambios**. Es un **explorador de archivos de solo lectura** de la carpeta en la que trabaja el agente: muestra **todos** los archivos, resalta los que tienen cambios según git y, al seleccionar uno, muestra su **diferencia** o su contenido. **No se puede editar nada** ni ejecutar acciones de git desde ahí.

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
| 🔒 **Solo lectura** | Recuerda que el explorador no edita |
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
| Imagen (png, jpg, gif, webp, svg, ico, bmp, avif) | La imagen sobre un fondo de cuadros (también si fue modificada) |
| Archivo binario | Aviso "Archivo binario" (sin texto que mostrar) |
| Archivo eliminado | En **Archivo**, la versión del último commit con un aviso |
| Archivo renombrado | Aviso "Renombrado desde `ruta/vieja`" y el diff entre ambas |
| Archivo nuevo sin seguimiento | Todo el contenido como líneas añadidas |
| Cambio sin texto (p. ej. solo permisos) | "Sin diferencias de texto…" |

Además: botón **Copiar ruta**, aviso cuando el diff o el archivo se recortaron por tamaño y botón **Mostrar todas las N filas** cuando hay más de 2 000.

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

## 13.4 API (solo lectura)

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

El explorador solo **lee** y está pensado para no interferir con el agente:

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
| `server/src/git.ts` | `gitStatus`, `gitTree`, `gitDiff`, `gitFile`, `gitImagePath`; validación de rutas |
| `server/src/api.ts` | Las 5 rutas `…/git/*` (la de `raw` escribe su propia respuesta binaria) |
| `web/lib/useGit.ts` | Hook: estado, árbol, refresco y *polling* |
| `web/lib/gitTree.ts` | Construye el árbol, compacta carpetas, filtra y aplana filas |
| `web/lib/diff.ts` | Parser de diff unificado y emparejado para la vista lado a lado |
| `web/components/GitExplorer.tsx` | Barra, árbol y vista previa |
| `web/app/agents/[id]/page.tsx` | Pestañas **Chat / Cambios** y la insignia |

## 13.7 Límites conocidos

- Muestra diferencias contra `HEAD`: no separa visualmente lo que está en el *stage* de lo que no (solo lo indica con una etiqueta).
- Sin resaltado de sintaxis ni diferencias a nivel de palabra.
- Los renombres se detectan con la heurística de similitud de git (`-M`).
- No muestra historial de commits, *blame* ni ramas; tampoco ofrece acciones (stage, commit, descartar).
- En repositorios enormes el árbol se recorta a 30 000 archivos y la lista visible a 2 000 filas (se avisa; el filtro permite llegar al resto).
- Los submódulos aparecen como una sola entrada.
