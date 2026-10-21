# Manual de hive-am

hive-am es un administrador de colonias de agentes de código. Te deja crear **orquestadores** y **workers** sobre las herramientas que ya usas (Claude Code, OpenCode y Kiro), agruparlos en **colonias**, hablar con ellos desde el navegador o desde Telegram, y ver todo lo que hicieron, incluso después de reiniciar la máquina.

No reemplaza a esos programas: ejecuta los que tienes instalados y nunca copia tus conversaciones a su propia base de datos. Todo corre en tu equipo y los datos viven en `~/.hive-am`.

![El mapa de la colonia de ejemplo con dos colonias, agentes y recursos](img/colonia-mapa.jpg)

*El mapa de la colonia: cada hexágono es un agente o un recurso, y cada área con contorno es una colonia.*

## Para quién es

Para quien trabaja con agentes de código y quiere más que una terminal: repartir tareas entre varios agentes, mantener sesiones reales que se reanudan, vigilar servidores y bases de datos del proyecto, revisar cambios de git y tener todo en una sola interfaz local.

## Índice

1. [Primeros pasos](01-primeros-pasos.md): requisitos, cómo arrancar hive-am, recorrido de la interfaz (Inicio y el menú) y tu primer agente.
2. [La colonia](02-la-colonia.md): el mapa de hexágonos, las estadísticas, las colonias y lo que comparten con sus agentes.
3. [Agentes](03-agentes.md): crear, configurar y administrar agentes.
4. [Chat](04-chat.md): conversar con un agente y entender lo que muestra la conversación.
5. [Orquestación y relaciones](05-orquestacion-y-relaciones.md): orquestadores que delegan en workers.
6. [Tipos y skills](06-tipos-y-skills.md): plantillas de agente y conocimientos reutilizables.
7. [Sesiones](07-sesiones.md): el historial real de cada agente y cómo reanudarlo.
8. [Programados](08-programados.md): mensajes y avisos que se envían a una hora definida.
9. [Conexiones (Telegram y Slack)](09-conexiones-telegram.md): hablar con un agente desde un bot de Telegram o una app de Slack.
10. [Recursos](10-recursos.md): servidores, contenedores, peticiones HTTP, bases de datos y clústeres.
11. [Explorador de cambios (git)](11-explorador-de-cambios-git.md): ver diferencias, historial, ramas y hacer commits.
12. [Terminales](12-terminales.md): el panel inferior con shells reales y logs.
13. [Permisos y seguridad](13-permisos-y-seguridad.md): qué puede hacer cada agente y qué protege hive-am.
14. [Problemas frecuentes](14-problemas-frecuentes.md): síntomas comunes y cómo resolverlos.

## Cómo leer este manual

- Los nombres de botones, pestañas y menús van en **negrita**, tal como aparecen en la interfaz en español.
- Las rutas de la interfaz se escriben con `>`. Por ejemplo, **Colonia** > **Nuevo** > **Nuevo agente** significa: abre la pantalla Colonia, pulsa el menú **Nuevo** y elige **Nuevo agente**.
- Las capturas usan datos de ejemplo de un proyecto llamado "Tienda online", con los agentes Reina (orquestadora), Backend, Frontend, QA y Guardián. Tus nombres y valores serán distintos.
- Los capítulos están pensados para leerse en orden la primera vez. Después puedes saltar al que necesites.
- Los bloques **Nota** y **Consejo** señalan detalles que conviene no pasar por alto.

> **Nota:** este manual está disponible en español y en [inglés](../en/README.md) (con capturas de la interfaz en inglés). La interfaz de hive-am también se puede cambiar entre inglés y español con el selector **EN** / **ES** de la barra lateral. Los textos del manual siguen los nombres de la interfaz en español.

## Conceptos clave

- **Agente:** una configuración (nombre, proveedor, modelo, carpeta, permisos, instrucciones) más un puntero a su sesión real en la herramienta de línea de comandos. Es quien hace el trabajo.
- **Orquestador:** agente que planifica y delega tareas en los workers que tiene conectados.
- **Worker:** agente que hace el trabajo que recibe, de ti directamente o de un orquestador.
- **Colonia:** grupo de agentes dibujado junto en el mapa, que puede prestarles valores por defecto: carpeta de trabajo, permisos, skills y un contexto compartido.
- **Tipo:** plantilla para crear agentes con proveedor, modelo, instrucciones y skills ya rellenados.
- **Skill:** bloque de conocimiento en texto que se añade a las instrucciones de un agente, siempre o solo a demanda.
- **Cuaderno:** las notas persistentes que un agente guarda sobre lo que aprende. Puedes leerlas y editarlas desde sus ajustes.
- **Sesión:** la conversación real de un agente, guardada por la herramienta de línea de comandos. hive-am la lee desde allí y la reanuda.
- **Recurso:** algo que vive en la colonia y que puedes iniciar, detener o consultar: un servidor, un contenedor Docker, peticiones HTTP o un clúster que agrupa varios.
- **Conexión:** enlace entre un agente y una plataforma externa (Telegram) para hablar con él desde fuera del navegador.

Siguiente: [Primeros pasos](01-primeros-pasos.md)
