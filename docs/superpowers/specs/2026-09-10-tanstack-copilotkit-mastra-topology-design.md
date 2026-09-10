# Diseño: prototipo de topología TanStack Start, CopilotKit y Mastra

Fecha: 2026-09-10

## Pregunta

¿La topología remota de dos procesos conserva streaming, HITL, comandos autorizados y reconexión cuando el proceso BFF o Mastra se reinicia por separado?

## Decisión de diseño

Construir un spike ejecutable en una rama `prototype/*`, separado del producto:

- Un proceso BFF representa la frontera TanStack Start + CopilotKit Runtime. Acepta la sesión del Operator, expone SSE, valida comandos y conecta server-to-server con Mastra.
- Un proceso Mastra Server ejecuta un Workflow pequeño con streaming, suspensión HITL, reanudación y eventos observables por `offset`.
- PostgreSQL conserva los snapshots de Mastra y un esquema scratch de Factory para `MissionId`, `RunId`, Gates, comandos e idempotencia. La base es desechable y no contiene secretos reales.
- Una página mínima permite iniciar la Run, ver eventos, aprobar o rechazar el Gate, reconectar y solicitar el reinicio de cada proceso a través del supervisor del harness.

El `RunId` es estable. Cada evento tiene `sequence`, `runId` y tipo; el cliente conserva el último `sequence` y vuelve a observar desde ese punto. Los comandos pasan siempre por el BFF, que comprueba sesión, estado del Gate, política e idempotency key antes de llamar a Mastra.

## Alternativas consideradas

1. **Spike real de dos procesos con dependencias fijadas** — elegido: prueba la separación de fallos y los contratos de streaming y recuperación que importan para la decisión.
2. Simulador HTML de estados — descartado: mostraría una transición plausible, pero no demostraría reinicios, sockets, headers ni recuperación del proceso remoto.
3. Aplicación completa de producción — descartada: añadiría routing, autenticación y UI definitivos antes de resolver la pregunta arquitectónica.

## Escenarios de evidencia

1. Streaming normal: la UI recibe eventos ordenados y la Run termina con el mismo `RunId`.
2. Human Gate: el Workflow se suspende, el Operator aprueba mediante el BFF y Mastra reanuda el mismo snapshot.
3. Reinicio del BFF: se corta el stream, el cliente reconecta y recupera el estado y los eventos pendientes sin crear otra Run.
4. Reinicio de Mastra: el BFF vuelve a conectar, observa o reanuda la Run persistida y conserva la correlación.
5. Comando no autorizado: una petición sin sesión o con una acción no permitida se rechaza en el BFF y no llega al efecto.
6. Repetición de comando: la misma idempotency key produce una sola acción efectiva.

La evidencia mínima será: `RunId` único, secuencias monotónicas, Gate conservado, rechazo observable del comando no autorizado y cero efectos duplicados. El informe distinguirá entre replay de estado y replay token-perfect de AG-UI, y no prometerá exactly-once para efectos externos.

## Límites

El artefacto será throwaway y no se incorporará al runtime de Factory. No probará carga, multi-réplica, failover de PostgreSQL, proveedores externos reales ni seguridad frente a un host comprometido. Las versiones de TanStack, CopilotKit, AG-UI y Mastra quedarán fijadas en el manifiesto del prototipo; si una integración oficial no puede ejecutarse con esas versiones, el informe lo registrará como resultado y no lo ocultará con un mock.

## Salida

El prototipo incluirá README reproducible y `PROTOTYPE-REPORT.md`. La decisión validada se copiará como comentario de resolución en `Probar la topología TanStack Start, CopilotKit y Mastra`; el HTML, harness y logs quedarán en la rama de prototipo enlazada desde el ticket. El cierre del ticket se hará mediante pull request, no directamente.
