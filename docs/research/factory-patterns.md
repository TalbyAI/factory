# Patrones funcionales de software factories comparables

**Fecha de corte:** 2026-09-07

**Ticket:** [Extraer patrones funcionales de factories comparables](https://github.com/TalbyAI/factory/issues/2)

**Objetivo:** identificar patrones verificables que deben informar la Factory propia. Este informe no compara alternativas de adopción ni reabre la decisión de construirla.

## Resultado

Los productos convergen en una distinción que debe ser estructural en Factory:

```text
Mission (objetivo y contrato estable)
  ├─ Workflow / Workflow Run (coordinación durable)
  │    └─ Agent Session (conversación con un harness)
  ├─ Execution Environment (sandbox/workspace)
  ├─ Artifacts (entradas, evidencias y resultados)
  ├─ Gates (condiciones auditables)
  └─ External Projections (GitHub/Azure DevOps, de mejor esfuerzo)
```

Una `Mission` no debe ser sinónimo de issue, pull request, conversación, run ni sandbox. Warp conserva la identidad de su *work item* durante varias etapas y runs; T3 Code conserva un thread alrededor de una sesión y su rama; Symphony separa issue, intento, sesión y workspace; Sandcastle separa run, sesión del provider, branch y sandbox. Son objetos con ciclos de vida distintos, aunque la UI los presente juntos. [Warp: How Factories work](https://docs.warp.dev/factories/how-factories-work/), [Symphony SPEC](https://github.com/openai/symphony/blob/8001b52e3062495a16e520e4ceaf8f9de868c4d0/SPEC.md), [T3 Code: Working with threads](https://github.com/pingdotgg/t3code/blob/8b2838e0e8a73d3fa6476940445c372e47b99db4/docs/user/thread-sidebar.md), [Sandcastle README](https://github.com/mattpocock/sandcastle/blob/e99f832f26dc9d245c019a9ddd19fa5dee792427/README.md)

La conclusión principal es adoptar un control plane pequeño y explícito: Work Types y Workflows predefinidos, transiciones validadas, Gates tipados, una bandeja única de atención, eventos de auditoría y reconciliadores de proyecciones externas. El agente puede investigar y proponer; no debe ser la autoridad que valida su propia transición ni ejecutar directamente una acción privilegiada.

## Método y calidad de la evidencia

Se tomó `docs/init` como inventario de hipótesis y se volvió a comprobar cada patrón contra documentación, repositorios y especificaciones de sus propietarios. Para repositorios se fijan enlaces a los commits observados; para Warp se usa su documentación oficial, actualizada el 3 de septiembre de 2026.

Se distingue entre:

- **Entregado:** documentación de uso o código presente en el producto.
- **Declarado:** comportamiento descrito por el proveedor, pero no verificable por código público.
- **Visión:** diseño futuro; sirve para inspirar una interfaz, no para afirmar capacidad actual.

Warp Factories permanece en Early Access; Symphony se define como especificación Draft v1; T3 Code avisa que el producto es muy temprano; Buzz declara explícitamente que no está terminado. Por tanto, la coincidencia entre varios sistemas pesa más que cualquier afirmación aislada.

## Lectura de los sistemas

| Sistema | Unidad estable | Coordinación y Gates | Operación y colaboración | Patrón trasladable | Límite que no copiar |
|---|---|---|---|---|---|
| Mastra Factory | Board card ligada a issue, PR, Linear o entrada manual | Topología del board, `transitionPolicy` y handlers `onEnter`/`onExit` separados; aceptación humana registrada | Board, chat/sesión, inbox `Needs attention`, audit append-only | Separar movimientos permitidos, autorización y efectos; validar por revisión y registrar actor | Sus boards todavía contienen supuestos internos de nombres/fases; no son un grafo general de Missions |
| Warp Factories | Un *work item* conserva identidad desde intake a handoff y abarca múltiples runs | Foreman enruta por triage, planning, build y review, omitiendo etapas; pausas humanas para spec, preguntas y handoff | Control room con Activity, run/session, coste, PRs, scorers y steering | Camino mínimo por tipo de trabajo; configuración versionada separada del estado operativo | No convertir el foreman probabilístico en autoridad de transición; el producto sigue Early Access |
| OpenAI Symphony | Issue normalizada; cada ejecución es un Run Attempt con Live Session y workspace | Elegibilidad por estado y blockers, concurrencia acotada, retry, reconciliación y cancelación | Logs estructurados y status surface opcional | Una sola autoridad de scheduling; polling de reconciliación aunque haya eventos; workspace determinista | Su scheduler es in-memory y recupera repolling, no timers/sesiones; el agente suele escribir el tracker |
| Buzz | Evento firmado dentro de channel/thread; agente con identidad propia | Cola por canal, una ejecución activa por canal, paralelismo entre canales; gate de autor antes del agente | Humanos y agentes comparten rooms, identidad, thread y audit; feed semántico con detalle progresivo | Identidad explícita, atribución y una actividad legible orientada a intervención | Los approval gates completos siguen “being wired up”; conversación/event log no sustituye el estado de Mission |
| T3 Code | Thread vinculado a proyecto, worktree/branch y PR | Permission mode por thread; trabajo paralelo por threads; preguntas/aprobaciones impiden settlement | Web/desktop/móvil, attach, tool output, subagents, pin/snooze/settle y acceso remoto | La consola debe optimizar supervisión, no obligar a leer transcripts; política visible por Mission | Los providers aplican permisos de forma distinta y T3 no aporta un motor de Workflow |
| GitHub Agentic Workflows | Workflow compilado y run de GitHub Actions | Agente read-only; `safe-outputs` estructurados se aplican en jobs separados con permisos y límites | Summary y artifacts de la run; operaciones GitHub auditables | Separar propuesta agentic de comando privilegiado; schemas, allowlists y límites por acción | Está centrado en GitHub y no modela Composite Missions multi-tracker |
| Sandcastle | Run sobre branch y sandbox, con sesiones propiedad del agent provider | Flujo explícito en TypeScript; varios agentes/rondas en sandbox persistente; verificación determinista entre runs | Streaming, commits, outputs tipados, timeouts y conservación de worktree sucio | Encapsular detalles de ejecución y sesión fuera del dominio de Mission | Es runner, no control plane durable; worktree o bind mount no son aislamiento fuerte |

### Mastra Factory: transición como decisión gobernada

La versión actual de `@mastra/factory` ya no es sólo un board fijo. Una definición declara fases y topología; `transitionPolicy` restringe movimientos; handlers de entrada/salida producen efectos. La política recibe una vista readonly con actor, origen, revisión y aceptación; no puede saltarse topología, autorización de ingress, ownership, checks de revisión ni persistencia atómica. Las evaluaciones pueden repetirse, pero un replay completado reutiliza el resultado guardado. [README de `@mastra/factory`](https://github.com/mastra-ai/mastra/blob/1f4f4b29632f40591a305c83ddf20390e16c8029/mastracode/factory/README.md), [`defineBoard`](https://github.com/mastra-ai/mastra/blob/1f4f4b29632f40591a305c83ddf20390e16c8029/mastracode/factory/src/boards/define-board.ts)

Dos decisiones de UX refuerzan el modelo:

- mover una tarjeta y pulsar su acción producen la misma transición; el origen visual no crea una ruta privilegiada;
- una run aparcada para aprobación aparece en `Needs attention` junto al resto de trabajo accionable, sin un silo separado de “approvals”.

Además, el audit local es append-only, diferencia actor humano/agente y enlaza la actuación del agente con el humano que inició la run. [`factory-card-button-is-a-transition`](https://github.com/mastra-ai/mastra/blob/1f4f4b29632f40591a305c83ddf20390e16c8029/.changeset/factory-card-button-is-a-transition.md), [`factory-attention-one-source`](https://github.com/mastra-ai/mastra/blob/1f4f4b29632f40591a305c83ddf20390e16c8029/.changeset/factory-attention-one-source.md), [Factory audit storage](https://github.com/mastra-ai/mastra/blob/1f4f4b29632f40591a305c83ddf20390e16c8029/mastracode/factory/src/storage/domains/audit/base.ts)

**Implicación:** Factory debe tener un solo command path para cada transición, venga de botón, CopilotKit tool, webhook o reconciliación. El handler valida `expectedRevision`, política y Gates, persiste el cambio y sólo entonces emite efectos. La UI optimista puede anticipar el resultado, pero nunca constituirlo.

### Warp Factories: identidad continua y camino mínimo

Warp define un *work item* como una solicitud única que conserva identidad desde intake hasta handoff aunque intervengan varios agentes. El foreman continúa conversaciones existentes y elige el camino más corto compatible con la política: puede saltar triage/planning, empezar a mitad o volver a una etapa anterior. Una run es una sola ejecución de agente; una unidad de trabajo puede contener varias. [Warp: How Factories work](https://docs.warp.dev/factories/how-factories-work/), [Warp: Factory dashboard](https://docs.warp.dev/factories/factory-dashboard/)

Su definición versionada en Git contiene configuración —repositorios, agents, automations, runners, scorers, skills y webhooks— pero no el estado de work items, runs o métricas. Un cambio externo pasa validación y se aplica atómicamente; si es inválido se conserva la última definición válida. Los triggers admiten filtros y una identidad de entrega para deduplicar retries. [Warp: Factory definition syntax](https://docs.warp.dev/factories/factory-as-code/)

**Implicación:** el `Workflow Router` no debe insertar siempre las mismas fases. Selecciona un Workflow predefinido según Work Type, origen y metadatos, y éste puede omitir pasos opcionales declarados. Sin embargo, la transición efectiva debe seguir siendo determinista; una recomendación del agente es input de un comando, no la decisión autoritativa.

### Symphony: reconciliación y autoridad única

Symphony hace explícito que el orchestrator es el único mutador del estado de scheduling. En cada tick reconcilia ejecuciones activas, valida configuración, obtiene candidatos y despacha hasta agotar slots. Modela motivos terminales distintos —fallo, timeout, stall y cancelación por reconciliación— porque producen recuperación y evidencia diferentes. Ordena candidatos por prioridad y antigüedad, excluye issues bloqueadas y libera una claim cuando el origen deja de ser elegible. [Symphony SPEC](https://github.com/openai/symphony/blob/8001b52e3062495a16e520e4ceaf8f9de868c4d0/SPEC.md)

Symphony también documenta su límite: tras reiniciar no restaura timers, workers ni live sessions; recupera utilidad releyendo el tracker y reutilizando workspaces. Factory ha decidido usar la durabilidad de Mastra y PostgreSQL, así que debe conservar el patrón de reconciliación sin heredar esta pérdida de estado.

**Implicación:** webhooks reducen latencia; nunca eliminan el reconciliador. Cada delivery necesita clave idempotente, cada efecto irreversible su propia clave, y el reconciliador debe poder reparar una `External Projection` sin reejecutar la Mission.

### Buzz: colaboración con identidad y feed para decidir

Buzz da a cada agente identidad propia, membresía y audit trail; no lo presenta como un bot invisible. Su harness aplica el gate de autor antes de que el evento llegue al agente, serializa trabajo dentro de un canal y permite paralelismo entre canales. Tras una desconexión reanuda con un filtro `since`, y al arrancar reproduce menciones no procesadas. [Buzz README](https://github.com/block/buzz/blob/3c7f288c60d67df78577b237e27c3dfc8831aaa1/README.md), [Buzz ACP harness](https://github.com/block/buzz/blob/3c7f288c60d67df78577b237e27c3dfc8831aaa1/crates/buzz-acp/README.md)

Su diseño de Activity Feed es especialmente trasladable: cada fila debe contestar “verbo, objeto, resultado”; una acción actualiza su fila en vez de duplicar mensajes; silencio, timeout e idle son estados visibles; fallos y escrituras tienen más prominencia que lecturas; el detalle crudo queda disponible por progressive disclosure. Es un documento de visión, no prueba de que toda esa UI esté terminada. [Buzz: Agent Activity Feed](https://github.com/block/buzz/blob/3c7f288c60d67df78577b237e27c3dfc8831aaa1/VISION_ACTIVITY.md)

**Implicación:** el Operator necesita una vista de actividad derivada de eventos semánticos y una vista raw para diagnóstico. GitHub/Azure comments pueden transportar conversación, pero la Factory conserva identidad, autorización y estado; el canal no ejecuta directamente un comando privilegiado.

### T3 Code: la consola como superficie de supervisión

T3 Code permite iniciar varios threads en background, cada uno con worktree propio. Separa trabajo activo, pinned, snoozed y settled; una pregunta, aprobación o background task pendiente impide el settlement automático, mientras el merge de la PR vinculada puede cerrarlo. Expone comandos y resultados, y una vista específica para subagents. [T3 Code: Working with threads](https://github.com/pingdotgg/t3code/blob/8b2838e0e8a73d3fa6476940445c372e47b99db4/docs/user/thread-sidebar.md)

Sus modos `Supervised`, `Auto-accept edits`, `Auto` y `Full access` son legibles, pero su documentación reconoce que cada provider los aplica de forma diferente. También agrega uso por provider/model/environment sin confundir la estimación de coste con facturación. [T3 Code: Permission modes](https://github.com/pingdotgg/t3code/blob/8b2838e0e8a73d3fa6476940445c372e47b99db4/docs/user/permission-modes.md), [T3 Code: Usage and limits](https://github.com/pingdotgg/t3code/blob/8b2838e0e8a73d3fa6476940445c372e47b99db4/docs/user/usage.md)

**Implicación:** la política de autonomía de Factory debe expresarse por acción, Workflow y entorno, aunque la UI ofrezca presets comprensibles. Un preset nunca puede prometer una garantía que Mastra o el sandbox no puedan aplicar.

### GitHub Agentic Workflows: separar propuesta y efecto

GitHub Agentic Workflows ejecuta al agente read-only por defecto. El agente solicita una operación mediante structured output; otro job, con permisos acotados, valida y ejecuta ese output. Los tipos permitidos, campos, máximos y dependencias se declaran antes de la run, y el contenido se sanea. Esta separación existe precisamente para limitar blast radius, mantener auditoría y defender frente a prompt injection. [GitHub Agentic Workflows: Permissions](https://github.github.com/gh-aw/reference/permissions/), [Safe Outputs](https://github.github.com/gh-aw/reference/safe-outputs/), [Security Architecture](https://github.github.com/gh-aw/introduction/architecture/)

**Implicación:** los tools de CopilotKit y los tools accesibles desde Mastra deben invocar el mismo command layer. Para cambios sensibles, el agente produce una `ProposedAction` tipada; una policy decide si puede ejecutarse automáticamente, queda pendiente de aprobación o se rechaza. El agente no recibe la credencial de escritura cuando basta con que un broker aplique la acción.

### Sandcastle: mantener el runner fuera del dominio

Sandcastle demuestra una frontera pequeña: AgentProvider, SandboxProvider, branch strategy, hooks, streaming, timeouts, structured output y commits devueltos. Un sandbox caliente puede alojar implementación, validación y revisión independientes sin recrear el entorno. A la vez, el almacenamiento y transferencia de una sesión pertenecen al provider porque sus formatos varían; intentar normalizar sus internals obliga a acoplarse a esquemas privados. [Sandcastle README](https://github.com/mattpocock/sandcastle/blob/e99f832f26dc9d245c019a9ddd19fa5dee792427/README.md), [ADR: Agent providers own session storage](https://github.com/mattpocock/sandcastle/blob/e99f832f26dc9d245c019a9ddd19fa5dee792427/docs/adr/0012-agent-provider-owned-session-storage.md)

**Implicación:** Factory referencia IDs y snapshots de Mastra, pero no interpreta sus tablas ni el formato interno de las sesiones. `MissionId ↔ workflowRunId` es correlación, no propiedad compartida del modelo.

## Decisiones que deben informar la especificación

### 1. Identidad, ejecución y proyecciones

El mínimo modelo separa:

- `Mission`: objetivo, Work Type, Completion Contract, versión de Workflow y snapshot de políticas.
- `Workflow Run`: ejecución durable de Mastra asociada a la Mission.
- `Agent Session`: conversación de uno de los agentes participantes.
- `Execution Environment`: sandbox y checkout usados por una ejecución.
- `Artifact`: input/output tipado, con origen, versión/hash y referencias.
- `External Projection`: issue, PR o Azure Work Item enlazado y su último estado observado.

Una Mission tiene una sola fuente externa autoritativa de intención, pero puede producir múltiples proyecciones y Artifacts. Cambiar un issue o PR externo crea evidencia nueva; no reescribe silenciosamente el snapshot usado por una run activa.

### 2. Transiciones: topología, policy y efectos

Cada Workflow predefinido declara:

1. qué transiciones existen;
2. qué Gates y política permiten cada transición;
3. qué efectos se solicitan después de persistirla.

Estas tres responsabilidades no deben fundirse en prompts ni callbacks con acceso irrestricto. Toda transición usa un comando idempotente y una revisión esperada. Un botón, webhook o tool del agente son ingress distintos al mismo comando.

### 3. Gates generales y Composite Missions

Un Gate puede depender de aprobación humana, Artifact validado, resultado externo o resolución de otras Missions. El gate de hijos no pertenece sólo a `Feature` o `Wayfinding Map`: cualquier futura `Composite Mission` puede declarar que sus hijas deben estar en estados terminales admisibles.

Para soportar Feature Slices y tickets de Wayfinder:

- una relación `blockedBy` controla la frontera ejecutable y debe rechazar ciclos;
- una relación padre/hija controla composición y el gate de cierre, no el orden;
- `Failed` no satisface el gate;
- una hija cancelada sólo lo satisface si el Operator aprobó su retirada y, en una Feature, volvió a aprobar el desglose afectado.

La Factory intenta proyectar parent/child y blockers en GitHub/Azure DevOps y también importar cambios externos válidos. Si el tracker no puede representar una relación, la semántica interna no se degrada; aparece drift visible.

### 4. Attention Inbox único

La bandeja debe listar acciones, no categorías técnicas. Como mínimo:

- aprobar o rechazar una propuesta;
- contestar una aclaración;
- resolver drift con el tracker;
- decidir sobre fallo/retry;
- atender una policy o security violation;
- completar una acción externa, como merge, que bloquea un Gate.

La vista de Mission muestra el siguiente Gate bloqueante y por qué; la vista de actividad resume `actor + acción + objeto + resultado`, con logs, transcript, diff y resultados de comandos bajo detalle progresivo.

### 5. Cierre por Completion Contract

El cierre no se deduce de que un agente termine ni de que exista una PR:

- `Feature Implementation` completa cuando su PR ha sido integrada.
- `Pull Request Review` completa cuando entrega el Artifact de revisión exigido y se publica/aprueba según su contrato.
- `Grilling`, `Research` y `Prototype` completan al aceptar su Artifact/decisión correspondiente.
- `Feature` completa cuando su especificación y desglose están aprobados y todas sus Feature Implementations hijas están resueltas de forma admisible.
- `Wayfinding Map` completa cuando no quedan hijos abiertos ni niebla pendiente y existe una `Exploration Conclusion`.

Esto diverge conscientemente de Warp, cuyo flujo termina en human handoff con merge bajo control del repositorio. Factory observará el merge humano como Gate externo y mantendrá la Mission en espera hasta entonces.

### 6. Recuperación y efectos seguros

El patrón mínimo es:

- webhook firmado para baja latencia;
- persistencia del envelope y deduplicación antes de actuar;
- reconciliación periódica del estado externo;
- reanudación durable de Mastra para estado del Workflow;
- idempotency key distinta por efecto irreversible;
- cancelación cooperativa más timeout/kill del sandbox;
- estado explícito para stall, timeout, retry, cancelación y drift.

No se debe usar “exactly once” como promesa. El contrato real es entrega al menos una vez más aplicación idempotente y reconciliable.

### 7. Autoridad y autonomía progresiva

La UI puede agrupar permisos en presets, pero la política almacenada es granular: `Workflow × action × environment`. Por defecto deniega; cada Mission conserva el snapshot con el que empezó. Una modificación posterior afecta nuevas Missions salvo migración explícita y auditada.

Incluso cuando una acción esté autoaprobada, debe atravesar el command layer. Las credenciales se asignan al broker/efector mínimo, no al prompt ni al sandbox completo.

### 8. Métricas orientadas al resultado

Warp aporta definiciones útiles de autonomy, cycle time y cost per PR, pero Factory no debe reducir todos los Work Types a una PR. La métrica común es `accepted outcome rate`: porcentaje de Missions cuyo Completion Contract fue aceptado sin rework sustancial. Se desglosa por Work Type y versión de Workflow.

Desde la primera versión conviene capturar:

- tiempo total y tiempo esperando al Operator o a sistemas externos;
- intervenciones, retries y rework;
- coste/tokens y minutos de sandbox;
- resultados de Gates y validaciones;
- aceptación del Artifact final;
- para Feature Implementation, tiempo hasta PR, revisión y merge.

Scorers, benchmarks y auto-mejora son valiosos cuando existan suficientes runs comparables. No hacen falta para validar el primer tracer bullet; sí hace falta conservar desde el inicio la evidencia que luego podrán evaluar. [Warp: Measure and improve](https://docs.warp.dev/factories/measure-and-improve/)

## Qué adoptar, diferir y rechazar

### Adoptar en la primera especificación

- Mission estable por encima de runs, sesiones, sandboxes y proyecciones.
- Workflows predefinidos y versionados elegidos por un router determinista.
- Topología, policy y efectos separados; un solo command path por mutación.
- Gates tipados, dependencias acíclicas y gate genérico de Composite Mission.
- Inbox único de atención y actividad semántica con evidencia expandible.
- Ingress idempotente, reconciliación y audit append-only con actor humano/agente.
- Propuestas agentic separadas de efectos privilegiados.
- Completion Contract y métricas por Work Type.

### Diferir hasta que exista evidencia de necesidad

- editor o definición dinámica de Workflows;
- auto-mejora de prompts/skills y benchmarks automáticos;
- múltiples harnesses, runners remotos y balanceo de flota;
- canales multiusuario y agentes con identidad social completa;
- configuración libre de boards como producto extensible.

### Rechazar como fundamento

- tracker, chat o thread como fuente autoritativa del estado de ejecución;
- un foreman LLM como único guardián de transiciones;
- escritura externa directa desde el agente cuando puede usarse un efector acotado;
- considerar worktree o Docker local una frontera suficiente para código hostil;
- cerrar una Mission porque terminó una run, sin evaluar su Completion Contract;
- prometer sincronización perfecta entre Factory y trackers.

## Correcciones y actualización de `docs/init`

- Mastra Factory sigue moviéndose con rapidez: el release observado publica `@mastra/factory` 0.12.0 y la implementación actual ya ofrece custom boards y transition policies. La conclusión “baseline útil, superficie cambiante” se mantiene, pero la matriz de agosto quedó atrás en versión y capacidad. [Mastra releases](https://github.com/mastra-ai/mastra/releases)
- El template actual se ejecuta con un único servidor UI/API y puede funcionar local y sin auth/integraciones; la decisión de Factory de separar TanStack Start/BFF y Mastra Server en dos procesos es una elección propia de aislamiento operativo, no una exigencia heredada. [Software Factory template](https://github.com/mastra-ai/softwarefactory-template/blob/6f05756a8a58fd12a42a93bf92dedd5f01cbb327/README.md)
- Warp Factories ya tiene documentación detallada, pero continúa en Early Access y usa schema `v1alpha1`; sus métricas y UX son evidencia de patrón, no de estabilidad.
- Buzz etiqueta los approval gates como trabajo todavía en integración. Sus principios de identidad/feed son aprovechables; no debe citarse como motor de Gates ya resuelto.
- Symphony sigue declarando que no recupera retry timers, running sessions ni live worker state tras reinicio. Factory necesita la durabilidad de Mastra/PostgreSQL además de reconciliación.
- T3 Code ha ampliado proveedores, source control y operación remota, pero sigue siendo una control surface; no aporta el modelo de Mission ni el Workflow durable.

## Conclusión

La Factory propia debe parecerse funcionalmente a Warp en continuidad del trabajo y control room, a Mastra Factory en transiciones gobernadas, a Symphony en scheduling/reconciliación, a Buzz en identidad y legibilidad de actividad, a T3 Code en supervisión de sesiones y a GitHub Agentic Workflows en separación entre propuesta y efecto.

No debe copiar ninguno como modelo completo. El punto diferenciador es un dominio propio donde `Mission`, `Completion Contract`, `Gate`, `Artifact` y `External Projection` sobreviven a cambios de tracker, UI, agent session y sandbox, mientras Mastra se ocupa de ejecutar y reanudar los Workflows.
