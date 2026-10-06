# 12. Operación, seguridad, límites y solución de problemas

## 12.1 Seguridad

hive-am está pensado como herramienta **local de un solo usuario**. Conviene conocer sus alcances:

| Aspecto | Estado actual |
|---|---|
| Red | El servidor escucha solo en `127.0.0.1` (no es accesible desde otras máquinas). El servidor de Next (`next dev`/`next start`) sí puede mostrar una dirección de red local; el proxy `/api` lo hace accesible desde ahí, aunque el backend sea local. |
| Autenticación | **No existe.** Cualquiera que pueda llegar a `/api` puede crear agentes y enviarles mensajes. |
| CORS | `Access-Control-Allow-Origin: *`. Cualquier página que abras en tu navegador podría hacer peticiones a `http://127.0.0.1:4400`. Dado que la API permite ejecutar agentes con acceso a tu máquina, **no navegues sitios no confiables mientras hive-am esté en marcha** o restringe el origen (ver mejoras). |
| Qué puede hacer un agente | Lo que permita su permiso y el CLI: `bypassPermissions` ejecuta cualquier comando sin preguntar; `acceptEdits` edita archivos libremente. Úsalos en carpetas de confianza. |
| Explorador de carpetas | `GET /api/fs/dirs` lista subcarpetas de cualquier ruta legible. |
| Explorador de cambios (git) | Las lecturas no escriben nada; las acciones (commit, pull, push, ramas) nunca fuerzan ni omiten *hooks* y rechazan peticiones que no vengan de la propia app. Todo limitado a la carpeta del agente; rechaza rutas fuera de ella (también por enlaces simbólicos) y cualquier ruta con `.git`. Detalle en el [documento 13](13-explorador-de-cambios-git.md#135-seguridad). |
| Secretos | hive-am no guarda credenciales. Los CLIs usan su propia sesión. La base de datos contiene tus prompts y skills en texto plano. |
| Lectores de historial | Validan los ids de sesión (Claude: `^[\w-]+$`; Kiro: UUID) y abren la base de OpenCode en solo lectura. |

### Mejoras de seguridad recomendadas (no implementadas)

- Restringir `Access-Control-Allow-Origin` al origen de la web (`http://localhost:4401`) y rechazar otros `Origin`.
- Token de acceso compartido entre Next (proxy) y el servidor.
- Verificar el encabezado `Host` para evitar *DNS rebinding*.

## 12.2 Limitaciones conocidas

| # | Limitación | Detalle |
|---|---|---|
| 1 | **Kiro orquesta mediante un perfil generado** | Escribe `~/.kiro/agents/hive-<agentId>.json` por cada orquestador Kiro con subagentes (se queda ahí al borrar el agente). |
| 2 | **Permisos en OpenCode** | Siempre `--auto`; `plan` (solo lectura) y el resto de permisos **no se aplican** a OpenCode. |
| 3 | **System prompt en OpenCode/Kiro** | Viaja dentro del mensaje (preámbulo), no como instrucción de sistema del CLI. Se oculta en la interfaz, pero el modelo lo ve como parte del mensaje. |
| 4 | **Turno en vuelo en un apagón** | Se pierde el turno a medias; la sesión queda intacta y el agente vuelve a `idle` al reiniciar. El mensaje hay que reenviarlo. |
| 5 | **`PATCH` de agente valida la carpeta efectiva después de guardar** | Si dejas al agente sin carpeta efectiva, el cambio ya quedó guardado cuando se devuelve el error. |
| 6 | **Lectura de historial sin caché** | `GET /api/sessions` y `…/stats` leen archivos completos en cada llamada; pueden tardar con sesiones enormes. |
| 7 | **Delegación sin tiempo límite** | `POST /api/dispatch` espera indefinidamente; si el worker se cuelga, el orquestador queda esperando. Se puede usar *Stop* en el worker. |
| 8 | **`Stop` no vacía la cola** | Aborta el turno en curso; los mensajes ya encolados continúan. |
| 9 | **Un turno a la vez por agente** | Incluye delegaciones: un worker ocupado hace esperar al orquestador. |
| 10 | **Costos estimados** | Para Claude se usan precios de lista por familia; los modelos desconocidos no tienen costo. Los valores marcados con `≈` son aproximados. |
| 11 | **Ventana de contexto fija** | La barra de estadísticas usa 200 000 tokens como referencia cuando el CLI no informa el %. |
| 12 | **Subagentes internos de Claude** | Las líneas `isSidechain` del `.jsonl` no se muestran en el chat. |
| 13 | **Formato de herramientas de Kiro** | Mapeo de `toolUse`/`ToolResults` de mejor esfuerzo (no hay ejemplos guardados para validarlo). |
| 14 | **Lista de modelos de OpenCode** | Depende de `opencode models`; si no devuelve líneas `proveedor/modelo`, la lista queda vacía (se puede escribir el id a mano). |
| 15 | **Sin pruebas automatizadas** | No hay suite de tests. |
| 16 | **Tipos duplicados** | `server/src/types.ts` y `web/lib/types.ts` se mantienen a mano. |
| 17 | **Mover agentes entre colonias** | Se hace con selectores y listas; no hay arrastrar y soltar en el panal. |
| 18 | **`type_id` informativo** | Editar un tipo no actualiza a los agentes ya creados. |
| 19 | **Parpadeo de idioma** | En la primera carga se ve brevemente el inglés base antes de aplicar el idioma guardado. |
| 21 | **Explorador de cambios** | Diferencias contra `HEAD` sin resaltado de sintaxis; árbol recortado a 30 000 archivos ([documento 13](13-explorador-de-cambios-git.md#137-límites-conocidos)). |
| 20 | **Contenido sin traducir** | Los nombres/descripciones creados por ti o por el seed, las instrucciones que reciben los agentes y los errores crudos de los CLIs se muestran como vienen (ver [documento 11](11-frontend.md#118-internacionalización-i18n)). |

## 12.3 Solución de problemas

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| Barra lateral dice "Server offline — retrying" | El servidor no está corriendo, o está en otro puerto | `npm run dev` / revisar `HIVE_AM_PORT` y `NEXT_PUBLIC_HIVE_WS_PORT` |
| `EADDRINUSE` al arrancar el servidor | Ya hay otra instancia en el puerto | Detenerla (`lsof -ti :4400`) o usar otro `HIVE_AM_PORT` |
| Cambié código del backend y no se nota | Servidor iniciado sin `tsx watch` | Reiniciarlo (`npm run dev` recarga solo) |
| "Internal Server Error" en Next / error de módulo `_document` o `_app` | Carpeta `.next` corrupta o compartida entre dos servidores de desarrollo | Detener `next dev`, borrar `web/.next` y reiniciar. Para una segunda instancia usar `NEXT_DIST_DIR` |
| El proveedor sale "not found" | El binario no está en el `PATH` del servidor | Instalar el CLI o arrancar el servidor desde un entorno donde `claude`/`opencode`/`kiro-cli` estén accesibles |
| El turno falla con `<cli> exited with code N: …` | El CLI falló (sesión caducada, modelo inválido, sin créditos…) | Leer el texto de stderr mostrado en el banner rojo; probar el comando a mano |
| "This agent has no working folder…" | Sin carpeta propia y sin colonia que la preste | Elegir carpeta en el agente o en su colonia |
| "Folder does not exist: …" | La ruta no existe (no se expande `~`) | Usar ruta absoluta o el botón **Browse** |
| Un agente de OpenCode dice trabajar en otra carpeta | Sesiones antiguas registradas con la carpeta del servidor | Ya corregido (`PWD`); esas sesiones se reemplazan por una nueva al siguiente mensaje |
| Un orquestador no delega | Sin subagentes conectados, el modelo decidió no hacerlo | Conectar workers (Relations/Team); pedir explícitamente "delega con dispatch a *nombre*" |
| El orquestador no ve agentes nuevos | Instrucciones antiguas en la sesión | Ya se reenvían cuando cambia el equipo; si persiste, *New conversation* |
| El historial sale vacío | El CLI cambió su formato de archivo, o la sesión se borró en el CLI | Revisar el lector correspondiente en `server/src/history/` y el archivo nativo |
| El costo no aparece | Modelo fuera de las familias conocidas y el CLI no reporta costo | Es esperado |
| Escribir en el chat va lento | Chats muy largos con muchísimas herramientas abiertas | Colapsar herramientas (**Collapse all tools**); en producción (`next build` + `next start`) es notablemente más rápido que `next dev` |
| `better-sqlite3` falla al instalar | Falta binario precompilado para tu Node/OS | Usar Node 20 LTS o instalar herramientas de compilación |
| Las tipografías se ven genéricas | Sin red en la primera compilación | Conectar y reiniciar `next dev`; la app funciona igual con fuentes del sistema |

## 12.4 Cómo verificar cambios (sin pruebas automáticas)

1. **Tipos:** `npm run typecheck` en la raíz.
2. **Compilación de la web:** `npm run build`.
3. **Humo del backend** con una instancia aislada:

   ```bash
   HIVE_AM_PORT=4410 HIVE_AM_HOME=/tmp/hive-prueba npm run start -w server
   curl -s localhost:4410/api/health            # {"ok":true}
   curl -s localhost:4410/api/agents            # lista (el seed no crea agentes, solo tipos y skills)
   ```
4. **Turno real:** crear un agente apuntando a una carpeta de prueba y enviarle un mensaje:

   ```bash
   curl -s -XPOST localhost:4410/api/agents -H 'content-type: application/json' \
     -d '{"name":"prueba","role":"worker","provider":"claude","model":"haiku","cwd":"/tmp/prueba"}'
   curl -s -XPOST localhost:4410/api/agents/<id>/messages -H 'content-type: application/json' -d '{"prompt":"hola"}'
   curl -s localhost:4410/api/agents/<id>/history
   ```
5. **Interfaz:** levantar la web de prueba con `NEXT_DIST_DIR` y `HIVE_AM_API` apuntando a esa instancia ([documento 3](03-puntos-de-entrada-y-ejecucion.md#correr-una-segunda-instancia-pruebas)).
6. **Delegación:** crear un orquestador (Claude u OpenCode), conectarle un worker y pedirle que delegue; comprobar la fila en `GET /api/dispatches`, la sesión de delegación en `GET /api/agents/<worker>/sessions` y que el chat directo del worker no cambió.

## 12.5 Mantenimiento de datos

- **Respaldo:** copia `~/.hive-am/` completo con el servidor detenido (por el modo WAL, también existen `hive-am.db-wal` y `-shm`).
- **Restablecer todo:** detener el servidor y borrar `~/.hive-am/`. Se recrea con el seed. Las conversaciones **no** se pierden: están en los almacenes de los CLIs.
- **Migraciones:** son aditivas y automáticas al arrancar (`ALTER TABLE … ADD COLUMN`). Una base creada con cualquier versión anterior del proyecto se actualiza sola.
- **Cambiar de lugar los datos:** variable `HIVE_AM_HOME`.

## 12.6 Control de versiones

El repositorio usa la rama `main`. La identidad de git está configurada **solo en este repositorio** (no globalmente). `.gitignore` excluye dependencias, salidas de build, logs y archivos `.env`.

## 12.7 Decisiones de diseño y su razón

| Decisión | Razón |
|---|---|
| Un proceso por turno en lugar de procesos residentes | Recuperación trivial tras caídas; no hay procesos huérfanos que gestionar |
| Leer el historial nativo en lugar de guardarlo | Nada que sincronizar o resumir; la sesión se puede abrir también con el CLI |
| Sin ACP como protocolo principal | Cada CLI ya ofrece salida JSON por líneas y reanudación por id; menos piezas |
| Sesión nueva por delegación | El chat directo del worker queda limpio y la tarea es auditable por separado |
| Herencia por campo con excepción por agente | Flexibilidad sin perder el control individual |
| Proveedor y modelo nunca heredados | Evita sorpresas de costo y compatibilidad entre CLIs |
| SQLite síncrono (`better-sqlite3`) | Un único proceso, consultas simples, cero infraestructura |
| Un solo CSS global con tokens | Control total de la identidad visual y tema claro/oscuro con pocas variables |
| Enrutador HTTP propio | 36 rutas; evita una dependencia de framework |
