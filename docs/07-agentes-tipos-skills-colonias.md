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
| `plan` (Read-only) | `--permission-mode plan` | Sin efecto (siempre `--auto`) | Sin `--trust-all-tools` |
| `acceptEdits` (Edit files) | `--permission-mode acceptEdits` | Sin efecto | `--trust-all-tools` |
| `bypassPermissions` (Full access) | `--permission-mode bypassPermissions` | Sin efecto | `--trust-all-tools` |

Detalle y límites en el [documento 6](06-proveedores.md) y el [12](12-operacion-y-problemas.md).

### Dónde se crea y edita un agente

| Lugar | Componente | Notas |
|---|---|---|
| Colony / Agents → **New agent** | `NewAgentDrawer` | Paso 1: elegir un tipo o "Blank agent"; paso 2: formulario. Si se abre desde la celda **+** de una colonia, la colonia viene preseleccionada. |
| Pantalla Types → **Create agent** | `NewAgentDrawer` con tipo fijo | Salta el paso 1. |
| Colony → botón de ajustes del agente seleccionado | `AgentEditDrawer` | Edita en un panel lateral sin salir del panal. |
| Pantalla del agente → **Settings** | panel plegable de `agents/[id]/page.tsx` | Incluye pestaña *Sessions* y borrado. |

Los tres usan el mismo formulario, `components/AgentForm.tsx`, con la misma validación (`validate()`):

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

`runtime.ts` arma, para cada turno, el texto de instrucciones del agente **resuelto**:

1. **Identidad** (`## Who you are`): nombre, rol (orquestador/worker), propósito (`description`), indicación de responder con su nombre y no como el CLI/modelo subyacente, su **carpeta de trabajo** y su **colonia** (nombre y carpeta compartida).
   - Si el turno es una delegación se añade que la tarea viene de un orquestador y debe terminar con un reporte breve y autocontenido.
2. **System prompt** efectivo (colonia + agente).
3. **Skills** efectivas, una sección por skill.
4. **Equipo** (solo orquestadores): ver [documento 9](09-orquestacion-y-relaciones.md#instrucciones-del-orquestador).

Cómo llegan al CLI: por `--append-system-prompt` en Claude (cada turno) y como preámbulo en el mensaje en OpenCode y Kiro ([documento 6](06-proveedores.md#66-preámbulo-de-instrucciones-providerspreamblets)).
