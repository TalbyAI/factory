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
Definición versionada que fija las entradas, salidas, Gates, decisiones del Operator y Completion Contract observables de una clase de Mission. Cada versión nombra sus entradas y salidas como Artifact Types con versión exacta —o como identificadores versionados de recursos externos— y puede seleccionar cualquier punto de una cadena canónica si cada Artifact inicial contiene o referencia todo el contexto exigido para determinar un Workflow compatible.
_Avoid_: Ticket type, workflow type

**Workflow**:
Proceso principal seleccionado para una ejecución; puede componer fases o subflujos, pero conserva la autoridad sobre el estado, los reintentos y la cancelación.
_Avoid_: Pipeline, agent loop

**Workflow Binding**:
Contrato versionado y determinista que transforma datos entre un Workflow y el Mission Graph en puntos explícitos. Cada Binding tiene un `bindingId` estable y un `bindingRevision`; para una Run fija un `inputFingerprint` del snapshot consumido y cada salida tiene un `outputKey` compuesto por Run, Binding, fingerprint y slot de salida. Un retry o replay con el mismo input reutiliza esos identificadores y, si conserva el mismo hash canónico, no añade Assertions ni Artifacts duplicados. Una salida distinta crea una revisión inmutable con `revisesOutput` y un identificador nuevo que el Completion Contract debe evaluar explícitamente.
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
Definición versionada de una clase semántica de Artifact y su validación. Cada versión referencia un validador concreto, inmutable y versionado; su catálogo es extensible y el media type declara la representación —JSON, Markdown, texto o binaria— sin hacer intercambiables Artifacts semánticamente distintos.
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
Contrato versionado que define las condiciones sobre el Mission Graph efectivo, los Artifacts, las validaciones y los Gates que satisfacen un Work Type, y referencia el validador concreto de esa versión. Cuando una entrada es revisable, exige el `revisionId` exacto y una relación `appliesToRevision`; rechaza cualquier aprobación o plan cuya revisión tenga una Assertion activa `supersedesRevision` o ya no sea la revisión efectiva. `derivedFrom` expresa linaje, no aplicabilidad.
_Avoid_: Definition of done, success metric

**Use Case**:
Escenario funcional vertical con actor, objetivo, comportamiento observable y criterios de aceptación. Una Mission de implementación puede realizar uno o varios Use Cases coherentes.
_Avoid_: Task, technical story

**Feature**:
Work Type v1 y Composite Mission. Entradas: `Change Proposal Document v1` con disposición `proposed-feature`, `Exploration Conclusion v1` o `Feature Specification v1` inicial con su contexto completo. Salidas: `Feature Specification v1` aprobada y uno o más `Feature Slice v1`. Gates: Human Gate conjunto para alcance, Specification y Slices, y Mission Gates para sus Feature Implementations. Decisiones del Operator: aprobar o pedir revisión del alcance, Specification y desglose. Completion Contract v1: Specification aprobada, Slices publicados y todas las Feature Implementations hijas en estado terminal admisible.
_Avoid_: Feature Definition, Feature Delivery

**Feature Specification**:
Artifact aprobado que define el alcance, comportamiento y criterios de aceptación de una Feature. Su descriptor conserva un `featureSpecificationId` y un `revisionId` inmutables; una nueva revisión publica en el Mission Graph una Assertion `supersedesRevision` sobre la anterior y cada aprobación o plan publica `appliesToRevision` con el identificador exacto. `derivedFrom` queda reservado para linaje. Los Completion Contracts de la Feature y sus implementaciones rechazan aprobaciones o planes ligados a una revisión superseded.
_Avoid_: Feature Definition, Feature ticket

**Feature Slice**:
Artifact hijo de una Feature Specification que agrupa uno o varios Use Cases coherentes y puede implementarse como una unidad.
_Avoid_: Task, User Story

**Feature Implementation**:
Work Type v1. Entradas: `Feature Slice v1`, `Feature Specification v1` con `revisionId` vigente, `Target` versionado y commit base exacto. Salidas: `Implementation Plan v1`, `Validation Report v1`, referencias Git y pull request integrado. Gates: Human Gate para aprobar el plan, External Gates para validación, CI e integración, y Mission Gate para un `Review Report v1` aprobado sobre el mismo commit. Decisiones del Operator: aprobar el plan y conceder las Autonomy Grants necesarias. Completion Contract v1: plan aplicable a la revisión exacta, validaciones satisfactorias, review aprobada para el head exacto e integración observada, sin Gates pendientes.
_Avoid_: Feature Slice, Development

**Implementation Plan**:
Artifact aprobado que describe cómo una Feature Implementation o Bug Fix realizará una entrada exacta sobre un Target y commit base concretos. Cuando implementa una Feature, incluye el `featureSpecificationRevisionId` y su aprobación publica `appliesToRevision`; cambiar esa revisión exige otro plan.
_Avoid_: Agent scratchpad

**Validation Report**:
Artifact que conserva las comprobaciones ejecutadas, sus resultados, la revisión Git exacta validada y la identidad inmutable —URI, versión y hash— del validador usado.
_Avoid_: Raw log

**Bug Report**:
Artifact que fija el comportamiento esperado, el observado y la evidencia disponible de un defecto.
_Avoid_: Feature request

**Bug Fix**:
Work Type v1. Entradas: `Bug Report v1`, `Target` versionado y commit base exacto. Salidas: `Implementation Plan v1`, `Bug Fix Report v1`, `Validation Report v1`, referencias Git y pull request integrado. Gates: Human Gate para el plan, External Gates para evidencia antes/después, regresión, CI e integración, y Mission Gate para un `Review Report v1` del head exacto; omitir una prueba automatizada exige Human Gate documentado. Decisiones del Operator: aprobar el plan, conceder Autonomy Grants y aprobar la omisión justificada de una prueba si procede. Completion Contract v1: plan aplicable, causa y corrección documentadas, validación satisfactoria, review aprobada para el head exacto e integración observada.
_Avoid_: Backfix, Feature Implementation

**Bug Fix Report**:
Artifact que documenta la causa identificada, la corrección aplicada y la evidencia de regresión de un Bug Fix.
_Avoid_: Validation Report

**Change Proposal**:
Work Type v1. Entradas: `Intent Document v1`. Salidas: `Change Proposal Document v1` con disposición exacta `proposed-feature`, `proposed-bug-fix` o `rejected`. Gates: Human Gate final. Decisiones del Operator: aprobar una de las dos propuestas, rechazarla o pedir `needs-revision`; esta última mantiene la Mission Open. Completion Contract v1: documento publicado y decisión final satisfecha; `needs-revision` no completa.
_Avoid_: Feature Specification, implementation

**Change Proposal Document**:
Artifact producido por una Change Proposal que conserva la propuesta elaborada y su disposición. Su profundidad puede ir desde una especificación breve hasta un TRD sin cambiar de tipo.
_Avoid_: Feature Specification

**Pull Request Review**:
Work Type v1. Entradas: `Target` versionado, pull request y commit head exactos. Salidas: `Review Report v1` ligado a ese commit, con veredicto `approve`, `changes-required` o `reject-recommended`. Gates: External Gate para observar el commit solicitado y ejecutar las comprobaciones definidas; no tiene Human Gate interno. Decisiones del Operator: ninguna para el veredicto —puede cancelar la Mission conforme a las reglas generales—. Completion Contract v1: Review Report inmutable con un único veredicto para el commit exacto; cualquier commit posterior exige otra Mission.
_Avoid_: Review campaign

**Review Report**:
Artifact que registra los hallazgos y el veredicto `approve`, `changes-required` o `reject-recommended` para un commit exacto.
_Avoid_: Pull request comment

**Wayfinding Map**:
Work Type v1 y Composite Mission. Entradas: `Intent Document v1`, destino y alcance versionados. Salidas: `Exploration Conclusion v1` y referencias a sus Missions hijas. Gates: Human Gates para destino, alcance y conclusión, y Mission Gates para las hijas. Decisiones del Operator: aprobar el destino, el alcance y la conclusión, o pedir revisión. Completion Contract v1: no quedan decisiones ni incertidumbre pendientes, la conclusión está publicada y las hijas están en resolución admisible.
_Avoid_: Project plan, implementation plan

**Exploration Conclusion**:
Artifact final de un Wayfinding Map que consolida las decisiones resueltas y determina qué Features, si las hay, deben originarse.
_Avoid_: Feature Specification, implementation plan

**Grilling**:
Work Type v1. Entradas: pregunta y contexto versionados, más los Artifact Types referenciados en su versión exacta. Salidas: `Decision Record v1`. Gates: Human Gate en la decisión compartida. Decisiones del Operator: responder, aclarar, continuar o cerrar con una decisión; abandonar sin decisión mantiene la Mission Open. Completion Contract v1: Decision Record publicado con decisión, razones y alternativas, y Human Gate satisfecho.
_Avoid_: Discussion, interview

**Decision Record**:
Artifact que conserva una decisión acordada, sus razones y las alternativas descartadas.
_Avoid_: Transcript, meeting notes

**Research**:
Work Type v1. Entradas: pregunta, alcance y requisitos de fuentes versionados. Salidas: `Research Report v1` con conclusión `supported`, `refuted` o `insufficient-evidence`. Gates: validación de cobertura y calidad de fuentes; una fuente no fiable mantiene el Gate Pending. Decisiones del Operator: resolver ambigüedades o cambiar el alcance; no se exige aprobación humana para completar. Completion Contract v1: informe publicado, evidencia contrastada y una de las tres conclusiones, incluida `insufficient-evidence`.
_Avoid_: Search, exploration

**Research Report**:
Artifact que conserva la evidencia, las referencias y una conclusión respaldada, refutada o insuficiente de una Research.
_Avoid_: Link collection

**Prototype**:
Work Type v1. Entradas: hipótesis, señales de aceptación y restricciones versionadas. Salidas: uno o más `Prototype Artifact v1` y `Prototype Report v1` con resultado `validated`, `refuted` o `inconclusive`. Gates: Human Gate para interpretar el resultado y External Gates para las señales observadas. Decisiones del Operator: aprobar la hipótesis, cambiar sus señales o aceptar la interpretación final. Completion Contract v1: Artifacts experimentales separados del producto, informe publicado y resultado interpretado; nunca constituye implementación productiva.
_Avoid_: Proof of production, implementation

**Prototype Report**:
Artifact que interpreta un Prototype como validado, refutado o no concluyente frente a sus señales de aceptación.
_Avoid_: Production validation

**Prototype Artifact**:
Artifact experimental inmutable producido por un Prototype y separado del producto; conserva la hipótesis, la señal observada y la versión de las restricciones que lo hicieron reproducible.
_Avoid_: Production artifact, implementation output

**Prerequisite Task**:
Work Type v1. Entradas: acción, Target y criterios de evidencia versionados. Salidas: `Prerequisite Result v1`. Gates: validación automática o Human Gate según el riesgo de la acción. Decisiones del Operator: autorizar la acción privilegiada, aceptar el resultado, mantenerla Waiting por imposibilidad temporal o declararla inalcanzable. Completion Contract v1: acción realizada y validada completa la Mission; imposibilidad temporal deja Waiting; inalcanzabilidad declarada termina Failed; nunca entrega la solución final.
_Avoid_: Implementation task, Feature Implementation

**Prerequisite Result**:
Artifact que conserva lo realizado por una Prerequisite Task y la evidencia que permite validarlo.
_Avoid_: Implementation output
