# Documentación de hive-am

hive-am es un administrador de agentes de programación. Permite crear **orquestadores** y **subagentes** sobre tres CLIs ya instalados en tu máquina (**Claude Code**, **OpenCode** y **Kiro**), agruparlos en **colonias**, darles **skills**, conversar con ellos desde el navegador y ver todo su historial, aun después de un apagón.

Esta carpeta describe el proyecto completo: cómo está organizado, cómo se ejecuta, dónde se guarda cada dato y cómo se comunican las piezas.

## Índice

| # | Documento | De qué trata |
|---|---|---|
| 1 | [Visión general](01-vision-general.md) | Qué es, principios de diseño, arquitectura, glosario |
| 2 | [Estructura del proyecto](02-estructura-del-proyecto.md) | Árbol de carpetas y responsabilidad de cada archivo |
| 3 | [Puntos de entrada y ejecución](03-puntos-de-entrada-y-ejecucion.md) | Cómo arranca todo, puertos, variables de entorno, scripts |
| 4 | [Almacenamiento](04-almacenamiento.md) | Base SQLite, tablas, migraciones, archivos de los CLIs, `localStorage` |
| 5 | [Comunicación back ↔ front](05-comunicacion-back-front.md) | API REST, WebSocket, flujo de un mensaje, reconexión |
| 6 | [Proveedores](06-proveedores.md) | Cómo se maneja Claude Code, OpenCode y Kiro; cómo añadir otro |
| 7 | [Agentes, tipos, skills y colonias](07-agentes-tipos-skills-colonias.md) | Modelo de datos, herencia, instrucciones compuestas |
| 8 | [Sesiones e historial](08-sesiones-e-historial.md) | Sesiones nativas, lectores de historial, reanudación |
| 9 | [Orquestación y relaciones](09-orquestacion-y-relaciones.md) | Delegación, MCP, reglas, cola por agente |
| 10 | [Chat y visualización](10-chat-y-visualizacion.md) | Cómo se muestra la conversación, herramientas, tokens y costos |
| 11 | [Frontend](11-frontend.md) | Páginas, componentes, estado, estilos y tema |
| 12 | [Operación y solución de problemas](12-operacion-y-problemas.md) | Seguridad, límites conocidos, diagnóstico, cómo probar |
| 13 | [Explorador de cambios (git)](13-explorador-de-cambios-git.md) | Pestaña **Cambios**: árbol de archivos con resaltado y visor de diferencias, historial y acciones de git (commit, pull, push, ramas) |
| 14 | [Conexiones externas](14-conexiones-externas.md) | Vincular un agente a Telegram: sesión única, herramienta `channel_reply`, permisos, API y pantalla **Conexiones** |

## Lectura recomendada

- **Quiero entender el proyecto rápido:** 1 → 2 → 3.
- **Voy a tocar el backend:** 4 → 5 → 6 → 8 → 9.
- **Voy a tocar la interfaz:** 5 → 10 → 11.
- **Algo no funciona:** 12.

## Convenciones de estas páginas

- Las rutas de archivo son relativas a la raíz del repositorio (`hive-am/`).
- Los fragmentos en inglés (nombres de campos, comandos, mensajes de la interfaz) se dejan tal cual existen en el código.
- Cuando algo es una limitación o una decisión consciente, se indica con **Nota** o se lista en el documento 12.
