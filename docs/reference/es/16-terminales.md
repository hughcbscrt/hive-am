# 16. Terminales

Un panel al pie de todas las pantallas guarda **terminales** (shells reales) y los **logs** de los objetos, en pestañas. Se abre con **Ctrl+`** (o con el botón *Terminal* al final del riel izquierdo); la primera vez inicia una terminal en tu carpeta personal. Arrastra su borde superior para cambiar la altura: la pantalla de arriba recibe la altura que queda, así que nada se esconde detrás (un chat sigue usable mientras vigilas un servidor).

## 16.1 Qué puedes abrir

- **+** una terminal en la carpeta de la última (la personal al principio); el botón de carpeta pide una carpeta.
- Desde la cabecera de un **agente**: una terminal en la carpeta del agente.
- Desde el panel de un **objeto** (ver [15](15-objetos-de-la-colonia.md)): para un **servidor**, *Terminal aquí* (en su carpeta); para un contenedor Docker (creado o existente), *Shell en el contenedor* (`docker exec -it … bash`, o `sh` si no hay bash); un proyecto compose tiene varios contenedores, así que solo tiene logs. Todo tipo que tiene logs tiene también *Logs en el panel*.

Las pestañas muestran lo abierto; × cierra una (una terminal se termina); un punto gris indica que el shell terminó (el código de salida está en el tooltip y escrito en la terminal). El navegador recuerda el estado del panel (abierto, altura, última pestaña).

## 16.2 Cómo funciona

Cada terminal es una pseudo-terminal (`node-pty`) en el **servidor**, dibujada con xterm.js. Por eso:

- Recargar la página, o abrir otra, muestra las mismas terminales; lo último que imprimieron (256 KB) se reproduce. Terminan cuando el servidor se detiene (a diferencia de los objetos servidor, que siguen corriendo).
- Los colores, las flechas, `vim`, `top`, el cambio de tamaño y el texto no ASCII funcionan como en cualquier terminal. El shell es el tuyo (`$SHELL`, interactivo) con tu entorno, sin las variables propias de hive-am.
- Hasta **12** terminales a la vez.

API: `GET /api/terminals` (`{ enabled, terminals }`), `POST /api/terminals` (`{ cwd?, title?, objectId?, agentId? }`), `DELETE /api/terminals/:id`, y el socket `/ws/terminal?id=` (mensajes JSON: `in`, `resize` desde la página; `init`, `out`, `exit`, `gone` desde el servidor).

## 16.3 Seguridad

Una terminal es **tu shell en tu máquina**: quien pueda hablarle puede ejecutar todo lo que tú. Por eso:

- Solo esta máquina: el `Host` debe ser un nombre de loopback (`localhost`, `127.0.0.1`, `[::1]`; se rechaza una página que llegó al servidor con otro nombre, como en el DNS rebinding) y el `Origin` de un navegador también: **otro sitio web abierto en tu navegador no puede llegar a una terminal**. Aplica a listar, crear, cerrar y al socket. Abrir hive-am por una dirección de la red local no da terminales.
- El servidor solo escucha en `127.0.0.1`.
- `HIVE_AM_TERMINALS=0` apaga las terminales por completo (el panel lo dice).
- **Los agentes no tienen herramienta para abrir ni usar terminales.** Un agente sigue trabajando con las herramientas de su CLI y su nivel de permisos.

## 16.4 La biblioteca de terminal

`node-pty` (la versión precompilada, `@homebridge/node-pty-prebuilt-multiarch`) es una dependencia **opcional**: donde no se pueda instalar o cargar, hive-am funciona igual y abrir una terminal lo dice. Reinstala sin `--omit=optional` (o instala ese paquete) para tenerla.

## 16.5 Pruebas

`server/scripts/test-terminals.ts` (sin modelo): un shell real por el socket (entrada, salida, tamaño, texto no ASCII, reproducción para una segunda página, código de salida), quién puede llegar a él (otro origen, un nombre de host reasignado), un shell dentro de un contenedor real, una terminal para un objeto servidor, límites y el interruptor de apagado.
