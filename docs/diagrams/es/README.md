# Diagramas de hive-am

> 🇬🇧 [Read in English](../en/README.md)

Diez diagramas de cómo funciona hive-am por dentro. Cada página sigue un camino real por el código (un mensaje de chat, un turno, una delegación, un recordatorio...) y relaciona cada paso con un archivo, una función y una línea, dice qué script de prueba cubre ese camino y lista sus casos límite. La [referencia](../../reference/es/README.md) explica cada pieza; estas páginas muestran cómo se conectan.

Líneas verificadas contra el commit `60f69d8`. Los números de línea se mueven conforme cambia el código: si uno no coincide, busca en el archivo la función o el símbolo que aparece junto a él.

## Diagramas

1. [Un mensaje de chat, ida y vuelta](01-channel-message.md): de Telegram o Slack al agente y de regreso, con las revisiones de acceso, el filtro de grupos y el filtro de secretos.
2. [Un turno dentro de un agente](02-agent-turn.md): la cola de cada agente, la llamada al proveedor, los eventos en el WebSocket y lo que se guarda al final.
3. [Cómo se arma el prompt efectivo](03-effective-prompt.md): las secciones de las instrucciones en orden, el hash que decide cuándo se reenvían y cómo las recibe cada CLI.
4. [Una delegación, con archivos](04-dispatch.md): `dispatch` desde la herramienta MCP hasta el turno del trabajador y de regreso al orquestador, en segundo plano y síncrona, cancelación y reinicio.
5. [Recordatorios y tareas programadas](05-wakeups-and-schedules.md): `wake_me`, `wake_when_done` y las programaciones, de la llamada a la herramienta al temporizador y la entrega.
6. [Procesos y puertos](06-processes-and-ports.md): qué corre, quién arranca a quién, qué puerto usa cada pieza y qué sobrevive a hive-am.
7. [Mapa del código de `server/src`](07-server-source-map.md): una línea por archivo, "para cambiar esto, abre aquello".
8. [Modelo de datos](08-data-model.md): las tablas de SQLite, sus relaciones y la migración que creó cada una.
9. [Ciclo de vida de un agente](09-agent-lifecycle.md): los estados de un agente y de sus sesiones, y lo que borra la retención.
10. [Proveedores](10-providers.md): Claude Code, OpenCode, Kiro y Cursor lado a lado: prompt, instrucciones, sesiones, MCP, permisos y procesos extra.

## Cómo leer una página

- Todas las páginas tienen las mismas secciones: qué muestra y cuándo consultarla, el diagrama, una tabla **Paso a paso**, los scripts que cubren el camino, casos límite y enlaces.
- Las rutas son relativas a la raíz del repositorio. `server/src/runtime.ts:57` es la línea 57 de ese archivo; la función o el símbolo de la columna siguiente está en esa línea o unas pocas líneas abajo.
- **Lo cubren** nombra scripts de `server/scripts/`. Un script marcado *sin modelo* corre sin ningún CLI ni cuenta; *levanta un servidor* quiere decir que necesita su propio `HIVE_AM_PORT` (nunca 4400); *necesita un modelo real* quiere decir que maneja un agente real (recibe un proveedor como argumento). Cómo correrlos: [referencia 12](../../reference/es/12-operacion-y-problemas.md).
- Los diagramas son bloques Mermaid, que GitHub dibuja. Simplifican a propósito; las tablas son exactas.
