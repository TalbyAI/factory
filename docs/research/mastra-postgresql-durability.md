# Garantías de durabilidad de Mastra sobre PostgreSQL

Fecha de corte: 7 de septiembre de 2026. La revisión usa la última versión estable observada, [`@mastra/core` 1.64.0](https://github.com/mastra-ai/mastra/releases/tag/%40mastra%2Fcore%401.64.0), que incluye `@mastra/pg` 1.22.3, y su código fuente en el commit [`c19a93b`](https://github.com/mastra-ai/mastra/tree/c19a93b0956f957581931786645d0597efec41eb). No se ejecutó un prototipo; las conclusiones separan contrato documentado, comportamiento inferido del código y asuntos que todavía necesitan prueba.

## Conclusión

Mastra con PostgreSQL es suficiente como motor durable de ejecución para la primera Factory, siempre que se acepte una semántica de **checkpoint y recuperación al menos una vez**, no de ejecución exactamente una vez.

Mastra persiste el estado de sus Runs, permite suspender y reanudar desde otro proceso, ofrece reintentos locales y puede reconstruir una Run activa desde el último snapshot. PostgreSQL añade persistencia compartida, actualización atómica del snapshot y exclusión de `resume()` concurrentes. Sin embargo, un paso interrumpido puede volver a ejecutarse completo, incluidos sus efectos externos. Mastra tampoco fija una versión de un Workflow compilado a una Run ni sustituye el estado autoritativo, los Gates o la auditoría de Mission.

Por tanto:

- **Mastra gobierna la ejecución interna del Workflow**: pasos, snapshots, suspend/resume y reintentos inmediatos.
- **Factory gobierna la Mission**: estado, Work Type, Completion Contract, Gates, dependencias, Artifacts, aprobación, versión del Workflow, idempotencia de efectos y reconciliación con sistemas externos.
- Factory debe persistir únicamente la relación `MissionId ↔ workflowId + runId + workflowVersion`; no debe interpretar ni modificar las tablas internas de Mastra.

## Matriz de garantías

| Capacidad | Qué puede asumirse | Límite |
|---|---|---|
| Snapshot en PostgreSQL | El estado serializable de una Run se guarda y puede recuperarse por `workflowName` y `runId`. | Es un snapshot mutable, no un event log ni un historial de checkpoints. |
| Suspend/resume | Una Run suspendida puede reanudarse desde otro proceso usando el snapshot persistido. | La aplicación debe conservar el `runId`, descubrir el paso suspendido y decidir quién puede reanudarlo. |
| Resume concurrente | Con `@mastra/pg` actual, una sola llamada reclama atómicamente la suspensión. | Esta protección cubre `resume()`, no todos los efectos externos ni dos recuperaciones de una Run `running`. |
| Reintentos | El motor por defecto ejecuta un paso hasta `attempts + 1` veces, con demora fija; `step.retries` sustituye el número del Workflow. | El bucle y su contador son locales al proceso; no hay evidencia en el modelo persistido de un presupuesto de reintentos conservado tras un crash. |
| Reinicio | `restart()` reconstruye una Run `running` o `waiting` desde el último paso activo; existen operaciones para listar y reiniciar todas las Runs activas. | El paso activo vuelve a comenzar. Los efectos ejecutados antes del último persist pueden repetirse. La recuperación automática sólo está documentada para el servidor local de Mastra. |
| Versionado de Workflow | Los Dynamic Workflows pueden persistirse y reemplazarse; su API es beta. | Una Run de un Workflow compilado no contiene un identificador de versión. Tras desplegar código nuevo, `restart()` usa el grafo y las funciones registrados por el proceso actual. |
| Actualizaciones paralelas | `WorkflowsPG` declara soporte concurrente y usa transacciones con `FOR UPDATE` para fusionar resultados y cambiar estado. | No existe una transacción común con las tablas de dominio de Factory ni con GitHub/Azure DevOps. |

## Evidencia

### Snapshots y PostgreSQL

La documentación define un snapshot como una representación serializable del estado completo de ejecución: input, resultados de pasos, ruta tomada, suspensiones y contexto necesario para continuar. También documenta que `suspend()` captura y persiste ese estado y que `resume()` lo vuelve a cargar para reconstruir la ejecución ([Snapshots, líneas 11–37](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/docs/src/content/en/docs/workflows/snapshots.mdx#L11-L37)). PostgreSQL es uno de los backends admitidos ([Snapshots, líneas 88–117](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/docs/src/content/en/docs/workflows/snapshots.mdx#L88-L117)).

En `@mastra/pg`, cada Run ocupa una fila identificada por `(workflow_name, run_id)`. `persistWorkflowSnapshot()` serializa el snapshot y realiza un `INSERT ... ON CONFLICT ... DO UPDATE`; `loadWorkflowSnapshot()` lee esa fila ([implementación de WorkflowsPG, líneas 412–485](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/stores/pg/src/storage/domains/workflows/index.ts#L412-L485)). Esto garantiza que el último snapshot confirmado permanece disponible, pero también implica que Mastra no conserva por sí mismo el historial anterior.

El snapshot contiene estado, input, resultados, rutas activas/suspendidas, grafo serializado y contexto de tracing; no contiene `workflowVersion` ni un hash de la definición ([`WorkflowRunState`, líneas 383–408](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/packages/core/src/workflows/types.ts#L383-L408)). Todo dato necesario para reanudar debe ser JSON-safe y conviene guardar referencias, no Artifacts pesados; la propia documentación pide minimizar el tamaño y monitorizar las Runs suspendidas ([Snapshots, líneas 158–164](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/docs/src/content/en/docs/workflows/snapshots.mdx#L158-L164)).

**Consecuencia para Factory:** los contenidos pesados de Artifacts quedan en filesystem local y el snapshot de Mastra sólo conserva IDs, hashes y datos de control pequeños. Factory debe respaldar PostgreSQL y definir retención; eliminar una fila de snapshot elimina la capacidad de resume/restart de Mastra.

### Puntos de persistencia y semántica al menos una vez

El comportamiento actual es más amplio que la descripción centrada en `suspend()`: por defecto, el motor persiste el paso como `running` antes de invocarlo ([step handler, líneas 160–217](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/packages/core/src/workflows/handlers/step.ts#L160-L217)) y vuelve a persistir su resultado al terminar ([entry handler, líneas 809–829](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/packages/core/src/workflows/handlers/entry.ts#L809-L829)). `shouldPersistSnapshot` puede desactivar selectivamente estos writes y por defecto devuelve `true` ([opciones del Workflow, líneas 1727–1737](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/packages/core/src/workflows/workflow.ts#L1727-L1737)).

De ahí se infiere la ventana crítica:

1. Mastra persiste «paso A running».
2. El paso A crea un comentario, branch, commit, PR u otro efecto externo.
3. El proceso muere antes de persistir «paso A success».
4. `restart()` vuelve a ejecutar el paso A.

El snapshot hace recuperable la Run, pero no puede probar si el efecto externo ocurrió. Ésta es semántica **at-least-once**. Ningún paso con efectos debe depender de que Mastra lo invoque una única vez.

**Responsabilidad de Factory:** cada comando externo necesita una clave idempotente estable derivada de `MissionId/runId/stepId/operation`, búsqueda previa del resultado existente y persistencia del identificador devuelto. Para transiciones entre PostgreSQL y webhooks/APIs externas se necesita reconciliación; no hay atomicidad distribuida que Mastra pueda aportar.

### Suspend/resume y concurrencia

La persistencia permite que `resume()` recargue una suspensión en otro proceso. La API pública también expone un lector estable del estado para localizar pasos suspendidos y sus labels sin depender del JSON privado ([Suspend and resume, líneas 220–242](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/docs/src/content/en/docs/workflows/suspend-and-resume.mdx#L220-L242)).

Desde la versión revisada, `resume()` intenta cambiar de forma atómica el estado persistido de `suspended` a `running`; un segundo consumidor falla con `WORKFLOW_RESUME_ALREADY_CLAIMED` sin ejecutar pasos ([referencia de `resume()`, líneas 230–251](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/docs/src/content/en/reference/workflows/run-methods/resume.mdx#L230-L251)). `WorkflowsPG` implementa el compare-and-set dentro de una transacción y bloquea la fila con `FOR UPDATE` ([WorkflowsPG, líneas 341–395](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/stores/pg/src/storage/domains/workflows/index.ts#L341-L395)).

La protección se pierde si se configura `shouldPersistSnapshot` para excluir `running`; el propio runtime advierte que entonces dos resumes pueden duplicar los pasos posteriores ([claim de resume, líneas 4320–4369](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/packages/core/src/workflows/workflow.ts#L4320-L4369)). Factory no debe desactivar snapshots `running` en sus Workflows.

**Responsabilidad de Factory:** autenticar y autorizar la aprobación, evaluar el Gate, emitir una única intención de resume, tratar `WORKFLOW_RESUME_ALREADY_CLAIMED` como conflicto idempotente y reconciliar después el estado de la Mission. El claim de Mastra no sustituye la auditoría del Operator.

### Retries

El contrato público documenta `retryConfig.attempts` y `delay` a nivel Workflow y `retries` a nivel de paso ([Error handling, líneas 187–232](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/docs/src/content/en/docs/workflows/error-handling.mdx#L187-L232)). En el motor por defecto, la implementación es un bucle en memoria de `retries + 1` intentos con una demora fija; `MastraNonRetryableError` lo detiene ([DefaultExecutionEngine, líneas 441–533](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/packages/core/src/workflows/default.ts#L441-L533)).

Hay una discrepancia relevante: la guía de snapshots afirma que se guardan los «remaining retry attempts», pero `WorkflowRunState` no tiene ese campo, el contador vive en un `Map` del proceso y se borra al comenzar cada ejecución/restart ([contador local, líneas 69–132](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/packages/core/src/workflows/default.ts#L69-L132); [reset, líneas 785–804](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/packages/core/src/workflows/default.ts#L785-L804)). Hasta demostrar lo contrario, el presupuesto de reintentos debe considerarse **no durable**: tras un crash, el paso activo empieza una nueva ejecución con un presupuesto nuevo.

**Responsabilidad de Factory:** definir el límite global de Attempts de una Mission, backoff, clasificación de errores, coste máximo y escalado al Operator fuera del retry local de Mastra. Los retries de Mastra sólo deben cubrir fallos transitorios, breves y con pasos idempotentes.

### Reinicio de proceso

Mastra expone `listActiveWorkflowRuns()`, `restart()` y `restartAllActiveWorkflowRuns()`. Las Runs `running` o `waiting` se recargan y `restart()` continúa desde el último paso activo ([documentación, líneas 497–534](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/docs/src/content/en/docs/workflows/overview.mdx#L497-L534)). La implementación enumera snapshots activos y recrea cada Run con su `runId` ([workflow recovery, líneas 2978–3023](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/packages/core/src/workflows/workflow.ts#L2978-L3023)); `restart()` carga el snapshot y ejecuta el grafo desde las rutas activas ([restart, líneas 4718–4849](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/packages/core/src/workflows/workflow.ts#L4718-L4849)).

La documentación limita la recuperación automática al **servidor local de Mastra**. En el deployer, el endpoint que dispara `restartAllActiveWorkflowRuns()` sólo se registra con `isDev` ([deployer, líneas 398–405](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/packages/deployer/src/server/index.ts#L398-L405)). No debe inferirse que un Mastra Server embebido en Factory recuperará Runs automáticamente en todas las topologías.

`restartAllActiveWorkflowRuns()` tampoco reclama cada Run mediante un lease antes de reactivarla. En un despliegue con varias réplicas, dos procesos que ejecuten recuperación pueden reiniciar el mismo paso. Esto se infiere del bucle de recuperación citado; requiere validación antes del despliegue remoto.

**Responsabilidad de Factory:** al iniciar el único Mastra Server local, ejecutar una reconciliación explícita de snapshots `running/waiting`, decidir cuáles siguen vinculados a Missions activas y reiniciarlos bajo un lock de instancia. En remoto hará falta leader election o un claim durable antes de activar varias réplicas.

### Versionado de definiciones

Los Workflows predefinidos son código registrado en el proceso. Aunque el snapshot almacena una representación serializada del grafo, `createRun()` construye el runtime con `this.executionGraph`, `this.retryConfig`, `this.steps` y `this.serializedStepGraph` de la definición actualmente registrada ([creación de Run, líneas 2555–2622](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/packages/core/src/workflows/workflow.ts#L2555-L2622)). `restart()` también combina el snapshot con `this.executionGraph` actual. No hay un ID de versión en `WorkflowRunState`.

Mastra sí ofrece Dynamic Workflows persistidos, pero la función es beta. Reemplazar una definición por el mismo ID hace que las nuevas Runs usen el grafo nuevo, y la documentación afirma que las ya iniciadas conservan el anterior ([Dynamic workflows, líneas 114–147](https://github.com/mastra-ai/mastra/blob/c19a93b0956f957581931786645d0597efec41eb/docs/src/content/en/docs/workflows/dynamic-workflows.mdx#L114-L147)). Esto no demuestra version pinning para los Workflows compilados elegidos por Factory y no justifica introducir Workflows dinámicos en la primera iteración.

**Responsabilidad de Factory:** guardar en cada Mission una `workflowVersion` inmutable —como mínimo versión semántica más Git SHA— y no reiniciarla en un proceso que no soporte esa versión. La opción mínima local-first es impedir el despliegue mientras existan Runs activas incompatibles; la evolución es mantener workers de versiones anteriores o aplicar una migración explícita y auditada.

## Responsabilidades que no deben delegarse a Mastra

1. Estado autoritativo y transiciones de Mission.
2. Work Type, Completion Contract, Gates, Composite Missions y grafo de dependencias.
3. Catálogo, contenido, hashes y retención de Artifacts.
4. Snapshot y aplicación auditada de políticas de autonomía.
5. Proyección de mejor esfuerzo y reconciliación con GitHub/Azure DevOps.
6. Idempotencia de comentarios, branches, commits, PRs y cualquier otro efecto externo.
7. Presupuesto durable de Attempts, coste y tiempo; decisión de reintentar, fallar o escalar.
8. Versionado y compatibilidad del Workflow asignado a cada Mission.
9. Arranque, leader election, detección de Runs huérfanas y reconciliación de estados divergentes.
10. Seguridad del sandbox, secretos, egress, autenticación del Operator, audit log y backups.

## Prototypes necesarios antes de dar la durabilidad por cerrada

Los siguientes experimentos deben ejecutarse con las versiones fijadas en el proyecto y PostgreSQL real, no con mocks:

1. **Crash en ventana de efecto:** matar el proceso después de crear un efecto externo y antes del snapshot final; comprobar que el paso se repite y que la clave idempotente evita el duplicado.
2. **Recuperación de servidor Factory:** suspender una Run y matar/recrear Mastra Server; verificar resume. Repetir con Runs `running` y `waiting`, invocando la reconciliación de arranque explícita.
3. **Retry durable:** matar el proceso durante el último retry y confirmar si el presupuesto vuelve a cero. Este test resuelve la contradicción entre documentación y código.
4. **Upgrade de Workflow:** suspender y dejar `running` una Run de versión A; desplegar versiones B compatibles e incompatibles y comprobar que Factory impide reanudarlas con el worker incorrecto.
5. **Carreras:** enviar dos approvals/resumes concurrentes y arrancar dos recuperadores. PostgreSQL debe excluir el doble resume; Factory debe excluir el doble restart.
6. **SIGTERM y SIGKILL:** verificar que el shutdown ordenado conserva el snapshot y medir qué se pierde bajo terminación abrupta.
7. **Tamaño y retención:** ejecutar una Mission larga con referencias a Artifacts, medir crecimiento/latencia de `mastra_workflow_snapshot` y probar backup/restore.

## Decisión propuesta

Adoptar Mastra Workflows + `@mastra/pg` para el tracer bullet con estas condiciones:

- una instancia PostgreSQL y schemas separados para Factory y Mastra;
- Workflows predefinidos, versionados y con persistencia de snapshots `running` habilitada;
- pasos con efectos externos idempotentes;
- reconciliación de arranque controlada por Factory;
- versión de Workflow fijada en cada Mission;
- Artifacts pesados fuera del snapshot;
- los siete prototypes anteriores como criterios de aceptación de la infraestructura durable.

No introducir Temporal ni Dynamic Workflows ahora. Reconsiderar un motor durable externo si Mastra no supera los tests de crash/recovery, si la Factory necesita varias réplicas activas o si los Workflows esperan durante días con un coste operativo de reconciliación significativo.
