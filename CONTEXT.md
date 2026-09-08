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
Clasificación inmutable que determina qué Workflow y contratos de Artifact corresponden a un trabajo.
_Avoid_: Ticket type, workflow type

**Workflow**:
Proceso principal seleccionado para una ejecución; puede componer fases o subflujos, pero conserva la autoridad sobre el estado, los reintentos y la cancelación.
_Avoid_: Pipeline, agent loop

**Workflow Router**:
Reglas deterministas que seleccionan un Workflow usando el Work Type, el origen y sus metadatos; cualquier clasificación ambigua requiere confirmación del Operator.
_Avoid_: AI router, dispatcher

**Artifact**:
Entrada o salida tipada y referenciable de un Workflow. Un Artifact producido por un trabajo puede utilizarse como entrada de otros trabajos relacionados.
_Avoid_: Attachment, output file

**External Projection**:
Representación de mejor esfuerzo del estado y las relaciones de una Mission en GitHub o Azure DevOps. Puede reconciliarse con el origen, pero no sustituye el estado autoritativo de la Factory.
_Avoid_: Replica, synchronized Mission

**Completion Contract**:
Conjunto de Artifacts de salida, validaciones y aprobación final que define un resultado satisfactorio para un Work Type.
_Avoid_: Definition of done, success metric

**Use Case**:
Escenario funcional vertical con actor, objetivo, comportamiento observable y criterios de aceptación. Una Mission de implementación puede realizar uno o varios Use Cases coherentes.
_Avoid_: Task, technical story

**Feature**:
Composite Mission que define una capacidad, produce y desglosa su Feature Specification, coordina sus Feature Implementations y sólo se completa cuando todas ellas están resueltas.
_Avoid_: Feature Definition, Feature Delivery

**Feature Specification**:
Artifact aprobado que define el alcance, comportamiento y criterios de aceptación de una Feature.
_Avoid_: Feature Definition, Feature ticket

**Feature Slice**:
Artifact hijo de una Feature Specification que agrupa uno o varios Use Cases coherentes y puede implementarse como una unidad.
_Avoid_: Task, User Story

**Feature Implementation**:
Work Type que implementa un Feature Slice y produce código, evidencias de validación y un pull request integrado.
_Avoid_: Feature Slice, Development

**Wayfinding Map**:
Composite Mission que organiza decisiones bajo incertidumbre. Concluye cuando no quedan decisiones ni niebla pendientes y produce una Exploration Conclusion que puede originar cero o más Features.
_Avoid_: Project plan, implementation plan

**Exploration Conclusion**:
Artifact final de un Wayfinding Map que consolida las decisiones resueltas y determina qué Features, si las hay, deben originarse.
_Avoid_: Feature Specification, implementation plan

**Grilling**:
Work Type interactivo que resuelve una decisión mediante preguntas del agente y respuestas del Operator.
_Avoid_: Discussion, interview

**Research**:
Work Type autónomo que obtiene y contrasta evidencia del repositorio o de fuentes externas y produce conclusiones documentadas.
_Avoid_: Search, exploration

**Prototype**:
Work Type interactivo que valida una hipótesis mediante un artefacto experimental separado del código principal del producto.
_Avoid_: Proof of production, implementation

**Prerequisite Task**:
Work Type que realiza una acción manual necesaria para desbloquear una decisión, sin implementar la solución investigada.
_Avoid_: Implementation task, Feature Implementation
