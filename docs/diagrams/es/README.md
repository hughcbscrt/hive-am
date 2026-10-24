# Diagramas de hive-am

> 🇬🇧 [Read in English](../en/README.md)

Diez diagramas de cómo funciona hive-am por dentro. Cada página sigue un camino real por el código (un mensaje de chat, un turno, una delegación, un recordatorio...) y relaciona cada paso con un archivo, una función y una línea, dice qué script de prueba cubre ese camino y lista sus casos límite. La [referencia](../../reference/es/README.md) explica cada pieza; estas páginas muestran cómo se conectan.

Líneas verificadas contra el commit `60f69d8`. Los números de línea se mueven conforme cambia el código: si uno no coincide, busca en el archivo la función o el símbolo que aparece junto a él.

## Diagramas


## Cómo leer una página

- Todas las páginas tienen las mismas secciones: qué muestra y cuándo consultarla, el diagrama, una tabla **Paso a paso**, los scripts que cubren el camino, casos límite y enlaces.
- Las rutas son relativas a la raíz del repositorio. `server/src/runtime.ts:57` es la línea 57 de ese archivo; la función o el símbolo de la columna siguiente está en esa línea o unas pocas líneas abajo.
- **Lo cubren** nombra scripts de `server/scripts/`. Un script marcado *sin modelo* corre sin ningún CLI ni cuenta; *levanta un servidor* quiere decir que necesita su propio `HIVE_AM_PORT` (nunca 4400); *necesita un modelo real* quiere decir que maneja un agente real (recibe un proveedor como argumento). Cómo correrlos: [referencia 12](../../reference/es/12-operacion-y-problemas.md).
- Los diagramas son bloques Mermaid, que GitHub dibuja. Simplifican a propósito; las tablas son exactas.
