# Software Factory

Control plane local-first para gobernar trabajo de ingeniería de software asistido por agentes.

## Language

**Operator**:
Único usuario humano que configura, supervisa y autoriza el trabajo de la Factory durante su etapa inicial.
_Avoid_: Administrator, developer user

**Mission**:
Unidad gobernable de trabajo con objetivo, Work Type y Completion Contract inmutables. Puede consumir y producir Artifacts, depender de otras Missions y coordinar Missions hijas.
_Avoid_: Case, Unit of Work, Work Item

**Composite Mission**:
Mission cuyo Completion Contract exige que todas sus Missions hijas alcancen un estado terminal admisible.
_Avoid_: Parent task, epic

**Gate**:
Condición auditable que debe satisfacerse antes de que una Mission cambie de estado. Puede requerir una aprobación, un resultado externo o la resolución de otras Missions.
_Avoid_: Workflow step, status

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
