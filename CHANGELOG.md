# Registro de cambios

Todos los cambios notables de hive-am se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y este proyecto sigue el [Versionado Semántico](https://semver.org/lang/es/).

## [Sin publicar]

### Añadido

- Administrador de agentes sobre Claude Code, OpenCode y Kiro, que reanuda la sesión nativa de cada CLI.
- Orquestadores y subagentes: delegación explícita, con una sesión nueva del subagente por cada tarea.
- Colonias con herencia opcional de carpeta, permisos, skills y contexto; mapa de panal, tipos de agente y lienzo de relaciones.
- Skills con carga siempre o bajo demanda (por asignación), con siete skills incluidas.
- Cuaderno del agente: memoria propia que se puede leer y editar desde la interfaz.
- Conexión con Telegram: chats privados, grupos y temas, silencio por hilo, archivos e imágenes en ambos sentidos y modelo de imágenes opcional.
- Tres niveles de permiso (solo leer, editar archivos y acceso total) que aplica el propio CLI en los tres proveedores.
- Explorador de cambios de git: árbol, diferencias, historial, commit, pull, push, ramas, conflictos, stashes, blame y descartar cambios.
- Interfaz en inglés y español, con tema claro y oscuro.
- Documentación completa en inglés y español.
- Paquete de npm con el comando `hive-am`.

[Sin publicar]: https://github.com/hughcbscrt/hive-am/commits
