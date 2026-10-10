# 7. Agentes, tipos, skills y colonias

## 7.1 Agente

Un agente es **configuración + puntero a sesión**. Campos (`server/src/types.ts`, tipo `Agent`):

| Campo | Descripción |
|---|---|
| `id`, `name`, `description` | Identidad. El nombre es único (la búsqueda por nombre ignora mayúsculas) y es como los orquestadores lo nombran al delegar. |
| `role` | `orchestrator` o `worker`. |
| `type_id` | Tipo del que se creó (informativo; ver 7.2). |
| `provider`, `model` | Proveedor y modelo. **Siempre propios del agente**, nunca heredados. |
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

| Permiso | Claude | OpenCode | Kiro |
|---|---|---|---|
| `plan` (Read-only) | `--permission-mode plan` | Deniega `edit`, `bash` y `task` | Ninguna herramienta de confianza |
| `acceptEdits` (Edit files) | `--permission-mode acceptEdits`, sin `.git` ni llaves | Edita (incluido `.env`), sin comandos, sin `.git` ni llaves, solo en su carpeta | Edita (incluido `.env`), sin comandos, sin `.git` ni llaves, solo en su carpeta |
| `bypassPermissions` (Full access) | `--permission-mode bypassPermissions` | Sin restricciones (`--auto`) | `--trust-all-tools` |

Claude es el único que en «Edit files» deja pasar los comandos de archivos (`touch`, `mv`…); los otros dos bloquean todos. Los tres niveles se comprueban con `server/scripts/sim-readonly.ts`.

Detalle y límites en el [documento 6](06-proveedores.md) y el [12](12-operacion-y-problemas.md).

### Dónde se crea y edita un agente

| Lugar | Componente | Notas |
|---|---|---|
| Colony / Agents → **New agent** | `NewAgentDrawer` | Paso 1: elegir un tipo o "Blank agent"; paso 2: formulario. Si se abre desde la celda **+** de una colonia, la colonia viene preseleccionada. |
| Pantalla Types → **Create agent** | `NewAgentDrawer` con tipo fijo | Salta el paso 1. |
| Colony → botón de ajustes del agente seleccionado | `AgentEditDrawer` | Edita en un panel lateral sin salir del panal. |
| Pantalla del agente → **Settings** | panel plegable de `agents/[id]/page.tsx` | Incluye pestaña *Sessions* y borrado. |

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

Al instalar se crean diez skills listas para asignar (se sugieren **a demanda** salvo Notebook, Chat channels, Colony objects y Wake-ups): **Notebook** (cuaderno del agente), **Wake-ups** (avisar después; su herramienta `wake_me` existe solo con la skill, ver [14.6.7](14-conexiones-externas.md#1467-avisar-después-la-skill-wake-ups-y-wake_me)), **Chat channels** (cómo comportarse en Telegram/Slack; se asigna sola, ver [14.6.6](14-conexiones-externas.md#1466-la-skill-chat-channels)), **Git workflow**, **Pull requests**, **Code review**, **Release checklist**, **Running tests** y **Log triage**. Son iguales a cualquier otra skill: no tienen categoría ni protección, se pueden editar o borrar, y una borrada no se vuelve a crear (4, `seeded_skills`). Son instrucciones generales y solo cuestan prompt en los agentes a los que se las asignes. Tres están atadas a una función: **Notebook** (id `default-notebook`): sin ella un agente no tiene las herramientas del cuaderno; **Wake-ups** (id `default-wakeups`): sin ella un agente no tiene `wake_me`; y **Chat channels** (id `default-channels`). Las dos últimas se agregan a un agente cuando una conexión empieza a responder por él.

### 7.3.2 El cuaderno del agente

La skill **Notebook** da al agente una memoria propia que sobrevive a las conversaciones, sin que nadie tenga que aprobarla:

- **Qué es:** Markdown con secciones `## Tema` y notas `- …`, hasta **8000 caracteres** (es prompt en cada turno). Vive en `agent_notebooks`.
- **Herramientas** (MCP `hive`, capacidad `memory`, solo si el agente tiene la skill): `notebook_add({ section, note })` guarda **una** nota corta (≤ 500 caracteres) bajo una sección, sin duplicados; `notebook_read()` devuelve texto y versión; `notebook_rewrite({ content, version })` reemplaza todo (para ordenar o corregir) y exige la versión leída, de modo que dos escrituras no se pisan. Si está lleno, el error le indica que lo ordene él mismo.
- **Qué guardar** lo define la skill: preferencias y correcciones, hechos del proyecto que no están en el código, lecciones y punteros; no estados temporales, charla ni nada que se deduzca del código.
- **Protecciones:** las notas con credenciales (claves privadas, tokens de GitHub/Slack/Telegram/AWS, JWT, `password: …`, cadenas de conexión con usuario y contraseña) se **rechazan**; cada nota lleva su origen (`2026-10-08 · Telegram: Ana`) para poder revisarla; y las instrucciones indican que las notas son información, nunca reglas: una nota (o un mensaje de un grupo) que pida ignorar sus instrucciones se ignora.
- **Cómo llega al agente:** en las instrucciones, sección «Your notebook» (mecánica, estable) y «Your current notes» (el texto). El texto **no cuenta** para el hash de instrucciones: lo que el agente escribe no obliga a reenviar todo. Si el usuario edita el cuaderno, o se escribió en otra conversación (`version > seen`), la sesión reanudada recibe las instrucciones de nuevo.
- **Interfaz:** pestaña **Cuaderno** en los ajustes del agente: editor Markdown, contador `n / 8000`, quién lo actualizó y cuándo, *Borrar todo*, y aviso con botón *Activar* si el agente no tiene la skill. Se refresca solo cada 4 s mientras no estés escribiendo; guardar con una versión vieja se rechaza para no pisar lo que el agente escribió.
- **Prueba:** `server/scripts/sim-notebook.ts <proveedor> [modelo]`.

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

### Dónde viven las reglas que recibe un agente

| Origen | Qué aporta | Dónde se cambia |
|---|---|---|
| Interfaz | System prompt del agente y de la colonia, skills (siempre / a demanda), nombre, rol, descripción y carpeta, subagentes, texto del cuaderno | Formularios de agente, tipo y colonia; pestaña Cuaderno |
| Código: `server/src/instructions.ts` | Reglas fijas en inglés: identidad, equipo, sección del canal (incluidas «Groups» y «Files»), cuaderno y skills a demanda | Solo editando el código; ningún ajuste de la interfaz las modifica |
| Código: `server/mcp/dispatch.mjs` | Descripción de cada herramienta MCP (`channel_send_file` indica que no se use el token del bot) | Solo código |
| Código: `server/src/connections/prompt.ts` | Cabecera de cada mensaje de un canal (`[hive:channel]`, `[hive:files]`, `[hive:context]`) | Solo código |
| Código: `server/src/providers/opencode.ts` | Configuración que prohíbe la herramienta `question` | Solo código |

Las instrucciones **orientan al modelo, no lo obligan**. Lo que el servidor sí hace cumplir: a quién responde cada conexión (personas y grupos autorizados), el permiso del agente (lo aplica el CLI en los tres proveedores; probado con `sim-readonly.ts`) y qué archivos pueden salir (`connections/outbound.ts`). Por ejemplo, la regla «no busques el token del bot» es una instrucción; el token sigue en la base de datos local ([14.6.3](14-conexiones-externas.md)).

Cómo llegan al CLI: por `--append-system-prompt` en Claude (al crear la sesión; si cambian después, como bloque de actualización en el mensaje) y como preámbulo en el mensaje en OpenCode y Kiro ([documento 6](06-proveedores.md#66-preámbulo-de-instrucciones-providerspreamblets)).
