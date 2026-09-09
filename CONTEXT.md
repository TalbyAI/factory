# Software Factory

Control plane local-first para gobernar trabajo de ingeniería de software asistido por agentes.

## Language

**Operator**:
Único usuario humano que configura, supervisa y autoriza el trabajo de la Factory durante su etapa inicial.
_Avoid_: Administrator, developer user

**Mission**:
Unidad gobernable de trabajo con objetivo, Work Type y Completion Contract inmutables. Permanece Open hasta completar su contrato, declararse inalcanzable o retirarse su intención, terminando respectivamente como Completed, Failed o Cancelled, sin reapertura. Ready, Running y Waiting son situaciones operativas derivadas de sus Runs, Gates y transiciones disponibles; una Run fallida no la falla automáticamente. Puede consumir y producir Artifacts, depender de otras Missions y coordinar Missions hijas.
_Avoid_: Case, Unit of Work, Work Item

**Run**:
Ejecución durable de un Workflow asociada a una Mission. Recorre Queued, Running y Suspended antes de terminar como Succeeded, Failed o Cancelled; Stalled es una condición derivada y timeout un motivo de fallo. Una Mission admite como máximo una Run no terminal. La Run conserva su identidad durante retries internos, suspensiones, reanudaciones y recuperación tras una caída; reintentar después de un resultado terminal crea una nueva Run enlazada con la anterior. Su éxito no completa por sí solo la Mission.
_Avoid_: Mission, Agent Session

**Composite Mission**:
Mission cuyo Completion Contract exige que todas sus Missions hijas alcancen un estado terminal admisible.
_Avoid_: Parent task, epic

**Gate**:
Condición auditable que protege una transición concreta de una Mission. Su evaluación produce Pending, Satisfied o Denied con evidencia; sólo Satisfied habilita la transición protegida. Denied la impide, pero el Workflow puede permitir otra transición, incluida una terminal. La transición consume una evaluación versionada sin que cambios posteriores la reviertan. Puede requerir una aprobación, un resultado externo o la resolución de otras Missions.
_Avoid_: Workflow step, status

**Human Gate**:
Gate decidido por el Operator. Su decisión puede sustituirse de forma auditada mientras ninguna transición la haya consumido.

**External Gate**:
Gate evaluado mediante observaciones de un sistema externo obtenidas por eventos y reconciliación. La falta de una observación fiable produce Pending, no Denied.

**Mission Gate**:
Gate evaluado a partir del estado de otras Missions. Mientras la Mission referenciada está Open —ya esté Ready, Running o Waiting— produce Pending; Completed produce Satisfied; Failed produce Denied; Cancelled produce Satisfied sólo con dispensa explícita del Operator y reaprobación del alcance afectado, y Denied en otro caso.

**Work Type**:
Definición versionada que fija las entradas, salidas y Completion Contract observables de una clase de Mission. No impone comenzar al principio de una cadena canónica, pero cada Artifact inicial debe contener o referenciar todo el contexto exigido para determinar un Workflow compatible.
_Avoid_: Ticket type, workflow type

**Workflow**:
Proceso principal seleccionado para una ejecución; puede componer fases o subflujos, pero conserva la autoridad sobre el estado, los reintentos y la cancelación.
_Avoid_: Pipeline, agent loop

**Workflow Binding**:
Contrato versionado y determinista que transforma datos entre un Workflow y el Mission Graph en puntos explícitos. Fija las entradas consumidas y convierte las salidas validadas en Assertions y Artifacts candidatos.
_Avoid_: Implicit synchronization, mapping DSL

**Execution Profile**:
Política versionada que fija el aislamiento, el acceso al filesystem y a la red, y los límites de recursos bajo los que puede ejecutarse una Run.
_Avoid_: Environment, runtime configuration

**Target**:
Recurso externo concreto que una acción puede leer o modificar, como un repositorio, proyecto o servicio. Se identifica por separado del Execution Profile.
_Avoid_: Environment, destination

**Autonomy Grant**:
Autorización revocable y auditable del Operator para que una versión concreta de un Workflow ejecute una acción concreta sobre un Target concreto bajo una versión concreta de un Execution Profile. Su alcance es un único uso, una Mission concreta o esa versión del Workflow; no se concede por Run.
_Avoid_: Permission level, autonomy score

**Privileged Action**:
Acción con efectos externos o sensibilidad de seguridad que requiere un Autonomy Grant o una aprobación exacta. Una acción no clasificada se considera privilegiada.
_Avoid_: Tool call, workflow step

**Workflow Router**:
Reglas deterministas que seleccionan un Workflow usando el Work Type, el origen y sus metadatos; cualquier clasificación ambigua requiere confirmación del Operator.
_Avoid_: AI router, dispatcher

**Artifact**:
Valor documental entregable, persistible e inmutable —binario, texto sin formato o JSON— con estructura y esquema conocidos. Su contenido se almacena fuera del grafo de Assertions, se referencia desde él y puede declarar linaje mediante `derivedFrom`; cualquier cambio produce otro Artifact, nunca lo modifica.
_Avoid_: Attachment, output file

**Artifact Type**:
Definición versionada de una clase semántica de Artifact y su validación. Su catálogo es extensible y el media type declara la representación —JSON, Markdown, texto o binaria— sin hacer intercambiables Artifacts semánticamente distintos.
_Avoid_: Universal artifact format

**Intent Document**:
Artifact inmutable que captura una intención sustantiva expresada por el Operator o recibida desde un sistema externo. Los cambios posteriores del origen producen otro Intent Document.
_Avoid_: Live issue body, mutable prompt

**Assertion**:
Afirmación tipada e inmutable emitida sobre una Mission y almacenada en su grafo. Relaciona un sujeto y un predicado con un valor pequeño o una referencia; otra Assertion puede retirarla, pero nunca modificarla ni borrarla.
_Avoid_: Fact, mutable metadata

**Mission Graph**:
Histórico append-only de las Assertions emitidas sobre una Mission. Su vista efectiva para una secuencia excluye las Assertions retiradas y es la que evalúan los contratos.
_Avoid_: Mutable state, fact store

**Retraction**:
Assertion que retira otra Assertion identificada exactamente. Reemplazar un valor publica el nuevo valor y la Retraction del anterior de forma atómica.
_Avoid_: Supersede, deprecation

**External Projection**:
Representación de mejor esfuerzo del estado y las relaciones de una Mission en GitHub o Azure DevOps. Puede reconciliarse con el origen, pero no sustituye el estado autoritativo ni su fallo reabre una Mission terminada.
_Avoid_: Replica, synchronized Mission

**Completion Contract**:
Contrato versionado que define las condiciones sobre el Mission Graph efectivo, los Artifacts, las validaciones y los Gates que satisfacen un Work Type.
_Avoid_: Definition of done, success metric

**Use Case**:
Escenario funcional vertical con actor, objetivo, comportamiento observable y criterios de aceptación. Una Mission de implementación puede realizar uno o varios Use Cases coherentes.
_Avoid_: Task, technical story

**Feature**:
Composite Mission que define una capacidad, produce y desglosa su Feature Specification, coordina sus Feature Implementations y sólo se completa cuando todas ellas están resueltas.
_Avoid_: Feature Definition, Feature Delivery

**Feature Specification**:
Artifact aprobado que define el alcance, comportamiento y criterios de aceptación de una Feature. Una nueva revisión deja sin aplicabilidad futura las aprobaciones y los planes ligados a la anterior.
_Avoid_: Feature Definition, Feature ticket

**Feature Slice**:
Artifact hijo de una Feature Specification que agrupa uno o varios Use Cases coherentes y puede implementarse como una unidad.
_Avoid_: Task, User Story

**Feature Implementation**:
Work Type que implementa un Feature Slice y produce código, evidencias de validación y un pull request integrado.
_Avoid_: Feature Slice, Development

**Implementation Plan**:
Artifact aprobado que describe cómo una Feature Implementation o Bug Fix realizará una entrada exacta sobre un Target y commit base concretos.
_Avoid_: Agent scratchpad

**Validation Report**:
Artifact que conserva las comprobaciones ejecutadas, sus resultados y la revisión Git exacta validada.
_Avoid_: Raw log

**Bug Report**:
Artifact que fija el comportamiento esperado, el observado y la evidencia disponible de un defecto.
_Avoid_: Feature request

**Bug Fix**:
Work Type que corrige un Bug Report y produce un Implementation Plan, un Bug Fix Report, evidencia de validación y un pull request integrado.
_Avoid_: Backfix, Feature Implementation

**Bug Fix Report**:
Artifact que documenta la causa identificada, la corrección aplicada y la evidencia de regresión de un Bug Fix.
_Avoid_: Validation Report

**Change Proposal**:
Work Type que desarrolla una intención informal breve y decide si propone una Feature, propone un Bug Fix o rechaza la intención.
_Avoid_: Feature Specification, implementation

**Change Proposal Document**:
Artifact producido por una Change Proposal que conserva la propuesta elaborada y su disposición. Su profundidad puede ir desde una especificación breve hasta un TRD sin cambiar de tipo.
_Avoid_: Feature Specification

**Pull Request Review**:
Work Type que evalúa un commit exacto de una pull request y produce un Review Report con veredicto inmutable. Un commit posterior requiere otra Mission de revisión.
_Avoid_: Review campaign

**Review Report**:
Artifact que registra los hallazgos y el veredicto `approve`, `changes-required` o `reject-recommended` para un commit exacto.
_Avoid_: Pull request comment

**Wayfinding Map**:
Composite Mission que organiza decisiones bajo incertidumbre. Concluye cuando no quedan decisiones ni niebla pendientes y produce una Exploration Conclusion que puede originar cero o más Features.
_Avoid_: Project plan, implementation plan

**Exploration Conclusion**:
Artifact final de un Wayfinding Map que consolida las decisiones resueltas y determina qué Features, si las hay, deben originarse.
_Avoid_: Feature Specification, implementation plan

**Grilling**:
Work Type interactivo que resuelve una decisión mediante preguntas del agente y respuestas del Operator y produce un Decision Record.
_Avoid_: Discussion, interview

**Decision Record**:
Artifact que conserva una decisión acordada, sus razones y las alternativas descartadas.
_Avoid_: Transcript, meeting notes

**Research**:
Work Type autónomo que obtiene y contrasta evidencia del repositorio o de fuentes externas y produce un Research Report.
_Avoid_: Search, exploration

**Research Report**:
Artifact que conserva la evidencia, las referencias y una conclusión respaldada, refutada o insuficiente de una Research.
_Avoid_: Link collection

**Prototype**:
Work Type interactivo que valida una hipótesis mediante Artifacts experimentales separados del producto y produce un Prototype Report.
_Avoid_: Proof of production, implementation

**Prototype Report**:
Artifact que interpreta un Prototype como validado, refutado o no concluyente frente a sus señales de aceptación.
_Avoid_: Production validation

**Prerequisite Task**:
Work Type que realiza una acción necesaria para desbloquear una decisión y produce un Prerequisite Result, sin implementar la solución investigada.
_Avoid_: Implementation task, Feature Implementation

**Prerequisite Result**:
Artifact que conserva lo realizado por una Prerequisite Task y la evidencia que permite validarlo.
_Avoid_: Implementation output
