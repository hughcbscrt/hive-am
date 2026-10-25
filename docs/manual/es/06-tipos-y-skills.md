# Tipos de agente y skills

Esta es la **biblioteca** de hive-am: dos secciones, en el grupo **Biblioteca e historial** de Inicio y en **Ctrl K**, que te ahorran repetir configuración. Los **tipos de agente** son plantillas para crear agentes con un par de clics. Las **skills** son bloques de instrucciones en Markdown que reutilizas en tantos agentes como quieras.

## Tipos de agente

Un tipo es una plantilla con proveedor, modelo, prompt, permisos, rol y skills. Entra en **Tipos de agente** desde Inicio o con **Ctrl K** ("tipos" o "plantillas" también la encuentran).

![Pantalla Tipos de agente con tres tarjetas: Builder, Reviewer y Queen, cada una con Editar y Crear agente](img/tipos-lista.jpg)

*Tres tipos de ejemplo. Cada tarjeta muestra el rol (Worker u Orquestador), el proveedor, el modelo, cuántas skills tiene y cuántos agentes lo usan. Señala los botones **Editar** y **Crear agente**.*

### Crear un tipo

1. Entra en **Tipos de agente** y pulsa **Nuevo tipo**.
2. Escribe el **Nombre** y una **Descripción** (se muestra al elegir un tipo).
3. Elige el **Rol**: Worker u Orquestador.
4. Elige el **Proveedor** (Claude Code, OpenCode, Kiro o Cursor) y el **Modelo**.
5. En **¿Qué puede hacer?** elige **Solo lectura**, **Editar archivos** o **Acceso total**.
6. Escribe el system prompt y añade las skills que quieras.
7. Pulsa **Crear tipo**.

### Editar un tipo

1. Pulsa **Editar** en la tarjeta del tipo.
2. Cambia lo que necesites.
3. Pulsa **Guardar tipo**.

![Panel Editar Builder con nombre, descripción, rol, proveedor, modelo y permisos; abajo Eliminar, Cancelar y Guardar tipo](img/tipo-editar.jpg)

*El panel de edición de un tipo. Arriba dice que los agentes existentes no cambian. Abajo están **Eliminar**, **Cancelar** y **Guardar tipo**.*

> **Nota:** editar un tipo **no cambia** a los agentes ya creados desde él. El tipo solo se usa en el momento de crear el agente.

### Eliminar un tipo

1. Pulsa **Editar** en la tarjeta.
2. Pulsa **Eliminar** y confirma con **Eliminar tipo** (o **Conservar tipo** para cancelar).

Los agentes ya creados conservan su configuración y solo pierden el vínculo con el tipo.

### Crear un agente desde un tipo

1. En la tarjeta del tipo, pulsa **Crear agente**.
2. Se abre el formulario **Nuevo agente** con el mensaje "Desde el tipo ..." y los valores del tipo ya rellenos.
3. Ponle nombre, elige la carpeta y ajusta lo que quieras.
4. Pulsa **Crear agente**.

Los valores se **copian**: desde ese momento el agente es independiente del tipo. Si en cambio pulsas **Nuevo** en la pantalla Colonia, el primer paso te deja elegir un tipo o **Agente en blanco**.

## Skills

Una skill es un bloque reutilizable de instrucciones: una lista de revisión, un estilo de commits, cómo correr tus pruebas. Se añade a las instrucciones del agente. Entra en **Skills** desde Inicio o con **Ctrl K**.

### Las que vienen con hive-am

Al instalar se crean diez skills listas para asignar:

- **Notebook:** el cuaderno del agente, una memoria propia entre conversaciones.
- **Wake-ups:** permite a un agente avisarse más tarde (ver [Programados](08-programados.md)).
- **Chat channels:** cómo comportarse en Telegram (ver [Conexiones](09-conexiones-telegram.md)). Se asigna sola cuando una conexión responde por un agente.
- **Colony resources:** cuidar los servidores y contenedores de la colonia (ver [Recursos](10-recursos.md)).
- **Database management:** mirar dentro de las bases de datos de la colonia y usarlas: estructura, consultas y, con el permiso adecuado, cambios (ver [Recursos](10-recursos.md#agentes-y-bases-de-datos)).
- **Git workflow**, **Pull requests**, **Code review**, **Release checklist**, **Running tests** y **Log triage**: guías generales.

Son iguales a cualquier otra skill: puedes editarlas o borrarlas, y una borrada no se vuelve a crear. Solo cuestan prompt en los agentes a los que se las asignes. Tres tienen una función atada: sin **Notebook** el agente no tiene las herramientas del cuaderno, sin **Wake-ups** no puede avisarse más tarde y **Chat channels** se agrega al agente que responde en un canal.

### El editor

![Biblioteca de skills con la lista a la izquierda y el editor Markdown en vista dividida de la skill Chat channels](img/skills-editor.jpg)

*La biblioteca. A la izquierda, la lista con el buscador, cuántos agentes y tipos usan cada skill y su peso en tokens (por ejemplo "~2.3k tokens"). A la derecha, el editor en modo **Dividido**: texto Markdown a un lado y vista previa al otro.*

El editor tiene una barra de formato y tres vistas: **Escribir**, **Dividido** y **Vista previa**. Abajo cuenta palabras y caracteres.

### Crear una skill

1. En **Skills**, pulsa **+** junto al buscador (o **Nueva skill**).
2. Escribe un **Nombre** único.
3. Escribe una **Descripción** de una línea. Se muestra en los selectores.
4. Escribe las **Instrucciones** en Markdown, como una guía que el agente sigue.
5. Pulsa **Crear skill**.

### Editar y borrar

1. Elige la skill en la lista. Mientras haya cambios, el botón dice **Guardar skill** y aparece "Sin guardar".
2. Edita y pulsa **Guardar skill**.
3. Para borrar, pulsa **Eliminar**. El aviso te dice de cuántos agentes y tipos se desvinculará. Confirma con **Eliminar skill** o cancela con **Conservar skill**.

### Buscar

Escribe en **Buscar skills** y la lista se filtra. Si nada coincide, verás "Ninguna skill coincide con ...".

### Cuánto pesan

Cada skill muestra su tamaño estimado en tokens (aproximadamente 4 caracteres por token). Importa porque una skill asignada se añade al prompt del agente en cada turno. Muchas skills largas encarecen cada turno.

## Asignar skills

Puedes asignar una skill a un **agente**, a un **tipo** o a una **colonia**:

- En el formulario de un agente o de un tipo, usa el campo **Skills**: busca con "Buscar skills para añadir..." y elige.
- En una colonia, las skills se suman a las de sus agentes si la colonia comparte skills (ver [La colonia](02-la-colonia.md)).

![Formulario Nuevo agente con la skill Notebook marcada como siempre y el texto "Siempre en el prompt: ~577 tokens · 0 bajo demanda"](img/agente-nuevo-skills.jpg)

*El selector de skills en el formulario de un agente. Señala la etiqueta **siempre** junto a Notebook y el resumen de peso debajo.*

### Siempre en las instrucciones o bajo demanda

Cada skill asignada se carga de una de dos maneras, y la eliges donde la asignas (no en la skill):

| Modo | Qué ve el agente | Cuándo usarlo |
|---|---|---|
| **siempre** | Todo su texto, en las instrucciones de cada turno | Reglas cortas que deben cumplirse siempre |
| **a demanda** | Solo una lista con nombre y descripción; el agente lee el texto con la herramienta `skill_read` cuando la tarea lo pide | Guías largas o situacionales |

Para cambiar el modo, haz clic en la etiqueta **siempre** o **a demanda** de la skill dentro del selector.

- Bajo el selector verás cuántos tokens van siempre en el prompt y cuántas skills van a demanda. Si es mucho, el aviso te sugiere pasar las más largas a "a demanda".
- Si una skill llega por la colonia y el agente también la tiene, vale el modo elegido en el **agente**.
- Al crear un agente desde un tipo se copian los modos del tipo.
- Para ver cuánto pesa cada skill junto al resto de las instrucciones, y cambiar el modo ahí mismo, abre **Ajustes** > **Instrucciones** del agente (ver [Agentes](03-agentes.md#instrucciones)).

> **Consejo:** deja "siempre" para reglas cortas y pasa a "a demanda" las guías largas. Así solo pagas la lista y el texto de las skills que se usan.

> **Nota:** en modo **Solo lectura** con Claude, las herramientas MCP están bloqueadas, así que las skills a demanda se incluyen completas.

Siguiente: [Sesiones](07-sesiones.md)
