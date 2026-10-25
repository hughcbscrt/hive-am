# 7. Agentes, tipos, skills y colonias

## 7.1 Agente

Un agente es **configuración + puntero a sesión**. Campos (`server/src/types.ts`, tipo `Agent`):

| Campo | Descripción |
|---|---|
| `id`, `name`, `description` | Identidad. El nombre es único (la búsqueda por nombre ignora mayúsculas) y es como los orquestadores lo nombran al delegar. |
| `role` | `orchestrator` o `worker`. |
| `type_id` | Tipo del que se creó (informativo; ver 7.2). |
| `provider`, `model` | Proveedor y modelo. **Siempre propios del agente**, nunca heredados. |
| `effort` | Esfuerzo de razonamiento de cada turno (`''` es el predeterminado del CLI). También propio del agente, nunca heredado, y lo copian los tipos y los clones. Ver [6.8](06-proveedores.md#68-deteccion-de-instalacion-y-modelos). |
| `permission` | `plan` (solo lectura), `acceptEdits` (edita archivos), `bypassPermissions` (acceso total). |
| `system_prompt` | Prompt propio. |
| `skill_ids` | Skills propias. |
| `cwd` | Carpeta propia (puede ser vacía si hereda). |
| `colony_id`, `overrides` | Colonia y campos donde ignora a la colonia. |
| `worker_ids` | Solo orquestadores: subagentes conectados (tabla `assignments`). |
| `session_id`, `session_cwd`, `instr_hash` | Sesión directa actual y datos para reanudarla ([documento 8](08-sesiones-e-historial.md)). |
| `status` | `idle`, `running`, `error`. |
| `effective` | **Calculado**: valores finales tras aplicar la colonia (ver 7.5). No se almacena. |

### Permisos y lo que significan por proveedor

| Permiso | Claude | OpenCode | Kiro | Cursor |
|---|---|---|---|---|
| `plan` (Read-only) | `--permission-mode plan` | Deniega `edit`, `bash` y `task` | Ninguna herramienta de confianza | `--mode plan`, deniega `Write(**)` y `Shell(*)` |
| `acceptEdits` (Edit files) | `--permission-mode acceptEdits`, sin `.git` ni llaves | Edita (incluido `.env`), sin comandos, sin `.git` ni llaves, solo en su carpeta | Edita (incluido `.env`), sin comandos, sin `.git` ni llaves, solo en su carpeta | Edita (incluido `.env`), sin comandos, sin `.git` ni llaves, **puede escribir fuera de su carpeta** |
| `bypassPermissions` (Full access) | `--permission-mode bypassPermissions` | Sin restricciones (`--auto`) | `--trust-all-tools` | `--force` sin reglas |

Claude es el único que en «Edit files» deja pasar los comandos de archivos (`touch`, `mv`…); los otros tres bloquean todos. Los tres niveles se comprueban con `server/scripts/sim-readonly.ts`.

Detalle y límites en el [documento 6](06-proveedores.md) y el [12](12-operacion-y-problemas.md).

### Dónde se crea y edita un agente

| Lugar | Componente | Notas |
|---|---|---|
| Colony / Agents → **New agent** | `NewAgentDrawer` | Paso 1: elegir un tipo o "Blank agent"; paso 2: formulario. Si se abre desde la celda **+** de una colonia, la colonia viene preseleccionada. |
| Pantalla Types → **Create agent** | `NewAgentDrawer` con tipo fijo | Salta el paso 1. |
| Colony → botón de ajustes del agente seleccionado | `AgentEditDrawer` | Edita en un panel lateral sin salir del panal. |
| Pantalla del agente → **Settings** | panel plegable de `agents/[id]/page.tsx` | Incluye las pestañas *Notebook*, *Instructions* y *Sessions* y borrado. |

Los tres usan el mismo formulario, `components/agents/AgentForm.tsx`, con la misma validación (`validate()`):

- El nombre es obligatorio y no puede repetirse.
- Debe haber carpeta efectiva: o la propia, o la de la colonia si la sigue.
- Para orquestadores aparece la sección **Team** (subagentes conectados).

El servidor valida de nuevo (`validateAgentInput`): nombre, proveedor, rol, que la carpeta **exista** en disco y que la colonia exista.

## 7.2 Tipos de agente

Un **tipo** es una plantilla: proveedor, modelo, prompt, permiso, rol, skills. Pantalla: `/types`.

- Crear un agente "desde un tipo" **copia** sus valores (`draftFromType` en la interfaz, o `POST /api/types/:id/spawn`). Después el agente es independiente: editar el tipo **no** cambia a los agentes ya creados.
- `type_id` queda como referencia para mostrar "N agentes usan este tipo".
- Los tipos no se heredan por colonia ni intervienen en tiempo de ejecución.
- El editor de tipos es el formulario de agente (`AgentForm` con `mode="type"`), así que un campo nuevo de agente se escribe una vez. El modo oculta lo que un tipo no guarda (carpeta, colonia y herencia, navegador, equipo, recursos) y conserva los textos propios de la pantalla de tipos; el nombre del tipo lo comprueba la pantalla, no `validate()`. Al guardar se envían solo los campos que guarda un tipo (`TYPE_FIELDS`, `typePayload`). Un campo nuevo que solo tenga el agente va bajo `!isType`.

## 7.3 Skills

Una skill es un bloque de instrucciones en markdown con nombre único y descripción. Pantalla: `/skills` (editor con pestañas *Write* / *Preview* y conteo de uso).

Se puede asociar a **tipos**, **agentes** y **colonias**. En ejecución se agrega al prompt con este formato:

```
## Skill: <nombre>
_<descripción>_

<contenido>
```

Las skills con contenido vacío se omiten. `GET /api/skills/usage` cuenta agentes y tipos que usan cada skill (las colonias no se cuentan).

### 7.3.1 Skills que vienen con hive-am

Al instalar se crean once skills listas para asignar (se sugieren **a demanda** salvo Notebook, Chat channels, Colony resources, Database management y Wake-ups): **Notebook** (cuaderno del agente), **Wake-ups** (avisar después; su herramienta `wake_me` existe solo con la skill, ver [14.6.7](14-conexiones-externas.md#1467-avisar-después-la-skill-wake-ups-y-wake_me)), **Chat channels** (cómo comportarse en Telegram/Slack; se asigna sola, ver [14.6.6](14-conexiones-externas.md#1466-la-skill-chat-channels)), **Recursos de la colonia** (cuidar los servidores y contenedores de la colonia; sus herramientas existen solo con la skill, ver [15.5](15-recursos-de-la-colonia.md#155-agentes-que-cuidan-objetos)), **Database management** (mirar dentro de los recursos de base de datos de la colonia y usarlos; sus herramientas `object_db_*` existen solo con la skill, ver [15.12](15-recursos-de-la-colonia.md#1512-agentes-que-usan-una-base-de-datos)), **Git workflow**, **Pull requests**, **Code review**, **Release checklist**, **Running tests** y **Log triage**. Son iguales a cualquier otra skill: no tienen categoría ni protección, se pueden editar o borrar, y una borrada no se vuelve a crear (4, `seeded_skills`). Son instrucciones generales y solo cuestan prompt en los agentes a los que se las asignes. Cuatro están atadas a una función (**Database management**, id `default-databases`, es la nueva: sin ella un agente no tiene las herramientas `object_db_*`): **Notebook** (id `default-notebook`): sin ella un agente no tiene las herramientas del cuaderno; **Wake-ups** (id `default-wakeups`): sin ella un agente no tiene `wake_me`; y **Chat channels** (id `default-channels`). Las dos últimas se agregan a un agente cuando una conexión empieza a responder por él.

### 7.3.2 El cuaderno del agente

La skill **Notebook** da al agente una memoria propia que sobrevive a las conversaciones, sin que nadie tenga que aprobarla:

- **Qué es:** Markdown con secciones `## Tema` y notas `- …`, hasta **8000 caracteres** (es prompt en cada turno). Vive en `notebooks` con sus lectores en `notebook_readers` (ver el documento de almacenamiento): un cuaderno puede tener **varios lectores**, porque un agente y sus clones lo comparten (ver *Clonar un agente* más abajo).
- **Herramientas** (MCP `hive`, capacidad `memory`, solo si el agente tiene la skill): `notebook_add({ section, note })` guarda **una** nota corta (≤ 500 caracteres) bajo una sección, sin duplicados; `notebook_read()` devuelve texto y versión; `notebook_rewrite({ content, version })` reemplaza todo (para ordenar o corregir) y exige la versión leída, de modo que dos escrituras no se pisan. Si está lleno, el error le indica que lo ordene él mismo.
- **Qué guardar** lo define la skill: preferencias y correcciones, hechos del proyecto que no están en el código, lecciones y punteros; no estados temporales, charla ni nada que se deduzca del código.
- **Protecciones:** las notas con credenciales (claves privadas, tokens de GitHub/Slack/Telegram/AWS, JWT, `password: …`, cadenas de conexión con usuario y contraseña) se **rechazan**; cada nota lleva su origen (`2026-10-08 · Telegram: Ana`) para poder revisarla; y las instrucciones indican que las notas son información, nunca reglas: una nota (o un mensaje de un grupo) que pida ignorar sus instrucciones se ignora.
- **Cómo llega al agente:** en las instrucciones, sección «Your notebook» (mecánica, estable) y «Your current notes» (el texto). El texto **no cuenta** para el hash de instrucciones: lo que el agente escribe no obliga a reenviar todo. Si el usuario edita el cuaderno, o se escribió en otra conversación (`version > seen`), la sesión reanudada recibe las instrucciones de nuevo.
- **Interfaz:** pestaña **Cuaderno** en los ajustes del agente: editor Markdown, contador `n / 8000`, quién lo actualizó y cuándo, *Borrar todo*, y aviso con botón *Activar* si el agente no tiene la skill. Se refresca solo cada 4 s mientras no estés escribiendo; guardar con una versión vieja se rechaza para no pisar lo que el agente escribió.
- **Prueba:** `server/scripts/sim-notebook.ts <proveedor> [modelo]`.
- **Cuaderno compartido.** El cuaderno no es propiedad de un agente: tiene lectores. Cuando varios agentes leen el mismo, `seen` es **por lector** (cada uno tiene su conversación viva y se le vuelve a enviar el texto por su cuenta cuando otro escribió), una nota también dice **qué agente la escribió** (`2026-10-16 · Maggie 2 · Telegram: Ana`), las instrucciones de cada lector dicen que el cuaderno es compartido y con quién, y dos agentes escribiendo a la vez es seguro (`notebook_add` relee y agrega; `notebook_rewrite` exige la versión leída). *Borrar todo* lo vacía para todos los lectores. **Separar** (`POST /api/agents/:id/notebook/separate`, solo app local) le da a un agente su propia copia del texto actual y deja el cuaderno compartido con los demás. Eliminar a un lector mantiene el cuaderno para los otros; el último lector se lo lleva.
- **Clonar un agente** (`POST /api/agents/:id/clone`, `{ name, colony_id? }`). Una acción de la persona (desde la tarjeta de la colonia o el pie de ajustes; no hay herramienta para los agentes). El clon es un **agente aparte**, así que corre en paralelo con su origen (los turnos de un agente se serializan: conversaciones al mismo tiempo necesitan agentes distintos), y **lee el mismo cuaderno**. Copia descripción, rol, tipo, proveedor, modelo, prompt, permiso, carpeta, overrides, `browser`, skills con cómo carga cada una y, si es orquestador, su equipo; su colonia es la del origen salvo que se dé otra. **No copia nada de lo que el origen hizo o tiene asociado**: ni `session_id` ni `instr_hash`, sesiones, delegaciones, avisos, programaciones, vigilancias, conexiones (un canal responde por un agente), administración de recursos (un recurso tiene un solo administrador) ni archivos del buzón. Pasa por la misma creación que cualquier agente: un nombre repetido se rechaza y un agente que se quedaría sin carpeta no se crea. El clon trabaja en la misma carpeta que su origen salvo que se diga otra cosa, así que dos agentes pueden editar los mismos archivos. El clon recuerda su origen en `agents.cloned_from` (migración 7, `ON DELETE SET NULL`; la API de agentes lo devuelve), que la interfaz muestra como una etiqueta con el nombre del origen: en el mapa de la Colonia, el listado de Agentes, la cabecera del chat y la lista junto a él, y la pantalla de Relaciones (el origen muestra cuántos clones tiene). Prueba: `server/scripts/test-agent-clone.ts`.

### 7.3.3 Carga bajo demanda

Cada skill se puede cargar de dos maneras, y **se elige donde se asigna** (en un agente, un tipo o una colonia), no en la skill: la misma guía puede ser pesada para un agente y rutinaria para otro.

| Modo | Qué ve el agente | Cuándo usarlo |
|---|---|---|
| **Siempre** (`always`) | Todo su texto, en las instrucciones de cada turno | Reglas cortas que deben cumplirse siempre |
| **A demanda** (`on_demand`) | Una lista «Skills you can load» con nombre y descripción; el texto lo trae con la herramienta `skill_read({ name })` cuando la tarea lo pide | Guías largas o situacionales |

- **Dónde se cambia:** cada skill elegida es una *pill* con un botón `siempre` / `a demanda`; un clic lo alterna. Al añadir una skill nueva toma la sugerencia de la propia skill (`skills.load`); quitarla borra su elección. Bajo el selector se suma lo que va siempre en el prompt, con aviso si pasa de ~3000 tokens.
- **Quién gana:** si una skill llega por la colonia y el agente también la tiene, vale la elección **del agente**; si no, la de la colonia (`agent.effective.skill_loads`). Al crear un agente desde un tipo se copian las elecciones del tipo.
- **Al guardar una lista** de skills, las que ya estaban conservan su modo salvo que se envíe otro (`skill_loads` en `POST/PATCH` de agentes, tipos y colonias: `{ [skillId]: "always" | "on_demand" }`).
- **Por qué:** con muchas skills asignadas, cargarlas todas completas encarece cada turno. Así solo se paga la lista (unas pocas líneas) y el texto de las que se usan.
- **Cómo funciona:** `skill_read` es del MCP `hive` (capacidad `skills`, solo si el agente tiene alguna skill a demanda). Responde únicamente con skills que ese agente tiene (también las de su colonia). Una vez leída, queda en la conversación. El texto a demanda **no cuenta** para el hash de instrucciones: editar esa skill llega al agente en su próxima lectura, sin reenviar nada.
- **Excepción:** Claude bloquea todas las herramientas MCP en modo Solo lectura (`plan`), así que ahí las skills a demanda se incluyen completas.
- **Peso a la vista:** la biblioteca y el selector muestran el tamaño estimado de cada skill (~4 caracteres por token; `web/lib/tokens.ts`).
- **Prueba:** `server/scripts/sim-skills.ts <proveedor> [modelo]` (incluye la herencia agente/colonia).

## 7.4 Colonias

Una colonia agrupa agentes y les **presta valores por defecto**. Se gestiona desde la pantalla Colony (`ColonyEditor.tsx`).

Campos: `name` (único), `color`, `cwd`, `permission`, `system_prompt` (contexto compartido), `skill_ids`, `inherit` y la lista de miembros.

### Qué se hereda

| Campo | Se hereda | Cómo se combina con el valor del agente |
|---|---|---|
| Carpeta (`cwd`) | Sí | La de la colonia **reemplaza** a la del agente (si la colonia tiene carpeta). |
| Permisos | Sí | La de la colonia **reemplaza** al del agente. |
| Skills | Sí | Se **suman**: primero las de la colonia, luego las del agente (sin duplicados). |
| Contexto (system prompt) | Sí | Se **antepone**: contexto de la colonia, línea en blanco, prompt del agente. |
| **Proveedor y modelo** | **Nunca** | Siempre son del agente. |

### Cuándo un agente sigue a su colonia

Para cada campo `f` ∈ {`cwd`, `permission`, `skills`, `prompt`}:

```
sigue(f) = el agente tiene colonia
        Y colonia.inherit[f] es verdadero
        Y f NO está en agente.overrides
```

- `colonia.inherit` es el valor por defecto que se decide al guardar la colonia.
- `agente.overrides` es la excepción individual: en el formulario del agente cada campo heredable muestra una casilla "Following / Own value".
- Al cambiar de colonia en el formulario, `overrides` se reinicia a `[]`.

### Pregunta al guardar una colonia

Cada vez que creas o guardas una colonia aparece **"What should its agents inherit?"** con casillas para carpeta, permisos, skills y contexto compartido:

- Una casilla se **desactiva** si no hay nada que compartir (p. ej. sin carpeta definida).
- Para una colonia nueva, las casillas con valor vienen marcadas.
- Si el cambio de carpeta moverá a agentes existentes, el cuadro avisa cuántos **empezarán una conversación nueva** (las anteriores se conservan en *Sessions*).

### Membresía

- Un agente pertenece como máximo a una colonia (`agents.colony_id`).
- Se asigna desde: el editor de la colonia (lista de miembros), el formulario del agente (selector *Colony*) o el panel lateral de la pantalla Colony.
- Al guardar la colonia con `agent_ids`, la lista **reemplaza** la membresía anterior (los no incluidos quedan sin colonia).
- Borrar una colonia deja a sus agentes sin colonia; dejan de heredar.

## 7.5 Resolución de valores efectivos

`server/src/db.ts`, función interna `agentRow`, calcula `effective` cada vez que se lee un agente:

```ts
effective = {
  cwd:           sigue('cwd') && colonia.cwd ? colonia.cwd : agente.cwd,
  permission:    sigue('permission') ? colonia.permission : agente.permission,
  system_prompt: [sigue('prompt') ? colonia.system_prompt : '', agente.system_prompt] // sin vacíos, unidos con "\n\n"
  skill_ids:     únicos([...(sigue('skills') ? colonia.skill_ids : []), ...agente.skill_ids]),
  inherited:     lista de campos que realmente sigue
}
```

`resolved(agent)` (también en `db.ts`) devuelve una copia del agente con `cwd`, `permission`, `system_prompt` y `skill_ids` ya sustituidos por los efectivos. **El runtime y los runners siempre trabajan con el agente resuelto**; la interfaz usa `effective` para mostrar la carpeta real y la etiqueta "from colony".

Si la carpeta efectiva queda vacía al empezar un turno, el turno falla con: *"This agent has no working folder. Set one on the agent or on its colony."*

## 7.6 Instrucciones compuestas (`composeInstructions`)

`instructions.ts` arma, para cada turno, el texto de instrucciones del agente **resuelto**:

1. **Identidad** (`## Who you are`): nombre, rol (orquestador/worker), propósito (`description`), indicación de responder con su nombre y no como el CLI/modelo subyacente, su **carpeta de trabajo** y su **colonia** (nombre y carpeta compartida).
   - Si el turno es una delegación se añade que la tarea viene de un orquestador y debe terminar con un reporte breve y autocontenido.
2. **System prompt** efectivo (colonia + agente).
3. **Skills** efectivas: las de carga *siempre* con su texto completo, una sección por skill; las *a demanda* como una lista «Skills you can load» (ver [7.3.3](#733-carga-bajo-demanda)).
4. **Equipo** (solo orquestadores): ver [documento 9](09-orquestacion-y-relaciones.md#95-instrucciones-del-orquestador).
5. **Conexiones** (si el agente tiene alguna): cómo llegan los mensajes de un canal y cómo responder; ver [documento 14](14-conexiones-externas.md).
6. **Cuaderno** (si tiene la skill Notebook): cómo usarlo, y aparte el texto actual de sus notas, que no cuenta para el hash de instrucciones ([7.3.2](#732-el-cuaderno-del-agente)).

### 7.6.1 Tamaño por parte (pestaña Instrucciones)

`instructionParts(agent, delegated)` devuelve los bloques que `composeInstructions` une con `\n\n`, en el mismo orden y con exactamente el mismo texto (`instr_hash`, [documento 8](08-sesiones-e-historial.md), es el sha1 de esa unión, así que un byte de diferencia reenviaría las instrucciones a toda conversación reanudada; `test-instructions-compose.ts` fija el texto y el sha1 de ocho agentes). Cada bloque tiene una `key` y un `group`: `identity`, `colony` (el prompt de la colonia, cuando el agente lo sigue), `own` (el prompt propio del agente), `skill` (una por skill cargada completa, con `skill_id`), `lazy_list`, `team`, `channel` (alias y la sección del canal) y `other` (notas del proveedor, wake-ups, recursos, bases de datos y las instrucciones del cuaderno). El prompt de colonia y el propio, que `agentOf` ya juntó, se separan de nuevo de modo que `colony + "\n\n" + own` es el prompt efectivo.

`GET /api/agents/:id/instructions-size` (`services/instructions-size.ts`) mide el agente **guardado**, resuelto, como conversación directa (una tarea delegada suma unos 170 caracteres a la identidad). No lee historiales.

| Campo | Significado |
|---|---|
| `provider`, `colony_id`, `colony_name` | El proveedor del agente y la colonia a la que pertenece. |
| `plan_all` | `true` para Claude en Solo lectura (`plan`): todas las skills van completas ([7.3.3](#733-carga-bajo-demanda)). |
| `parts[]` | Una entrada por bloque: `key`, `group`, `chars`, `tokens_est`; las skills añaden `skill_id`, `skill_name`, `mode` y `from_colony` (nombre de la colonia, cuando la skill solo viene de la colonia); `colony` añade `from_colony`; `lazy_list` y `team` añaden `count`; `channel` añade el nombre de la plataforma en `channel`. |
| `total_chars`, `total_tokens_est` | Suma de `parts[].chars` (los separadores `\n\n` no cuentan: `composeInstructions(a).length === total_chars + 2 * (parts.length - 1)`) y su estimación. |
| `on_demand[]` | Las skills que solo se listan: `skill_id`, `skill_name`, `from_colony`. |
| `lazy_overhead_chars` | Lo que la lista a demanda suma además de sus líneas, contado como `total_chars`: la cabecera «Skills you can load» y, en OpenCode, la nota sobre las herramientas hive cuando nada más la pide. La trae la primera skill a demanda y se va con la última; `0` con `plan_all`. |
| `notebook_chars`, `notebook_tokens_est` | Tamaño de `notebookBlock` (las notas), fuera del total. |

Los tokens son una estimación, `ceil(chars / 4)`, la misma regla que `web/lib/tokens.ts`. La pestaña web (`web/components/agents/InstructionsPanel.tsx`) ordena las partes por peso, junta `identity` y `other` en una fila y `channel` en otra, y estima «Al guardar» en el navegador con `saveDelta` (`web/lib/tokens.ts`): `skillWeight` sobre las skills propias del borrador frente a las guardadas, más o menos `lazy_overhead_chars` cuando el número de skills a demanda pasa de 0 a más o vuelve a 0, sin llamar al servidor. El umbral del aviso de skill pesada está en `HEAVY_SKILL_TOKENS` (800) y `HEAVY_SKILL_SHARE` (25%). Prueba: `test-instructions-size.ts`.

### Dónde viven las reglas que recibe un agente

| Origen | Qué aporta | Dónde se cambia |
|---|---|---|
| Interfaz | System prompt del agente y de la colonia, skills (siempre / a demanda), nombre, rol, descripción y carpeta, subagentes, texto del cuaderno | Formularios de agente, tipo y colonia; pestaña Cuaderno |
| Código: `server/src/instructions.ts` | Reglas fijas en inglés: identidad, equipo, sección del canal (incluidas «Groups» y «Files»), cuaderno y skills a demanda | Solo editando el código; ningún ajuste de la interfaz las modifica |
| Código: `server/mcp/dispatch.mjs` | Descripción de cada herramienta MCP (`channel_send_file` indica que no se use el token del bot) | Solo código |
| Código: `server/src/connections/prompt.ts` | Cabecera de cada mensaje de un canal (`[hive:channel]`, `[hive:files]`, `[hive:context]`) | Solo código |
| Código: `server/src/providers/opencode.ts` | Configuración que prohíbe la herramienta `question` | Solo código |

Las instrucciones **orientan al modelo, no lo obligan**. Lo que el servidor sí hace cumplir: a quién responde cada conexión (personas y grupos autorizados), el permiso del agente (lo aplica el CLI en los cuatro proveedores; probado con `sim-readonly.ts`) y qué archivos pueden salir (`connections/outbound.ts`). Por ejemplo, la regla «no busques el token del bot» es una instrucción; el token sigue en la base de datos local ([14.6.3](14-conexiones-externas.md)).

Cómo llegan al CLI: por `--append-system-prompt` en Claude (al crear la sesión; si cambian después, como bloque de actualización en el mensaje) y como preámbulo en el mensaje en OpenCode y Kiro ([documento 6](06-proveedores.md#67-preámbulo-de-instrucciones-providerspreamblets)).
