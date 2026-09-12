# Capacidades de modelado y eventos de GitHub y Azure DevOps

Fecha de investigación: 2026-09-07

Ámbito: GitHub Issues y Pull Requests; Azure DevOps Boards y Pull Requests

Pregunta: ¿qué capacidades nativas pueden sostener una External Projection de Missions y dónde debe aceptar degradación la Factory?

## Conclusión ejecutiva

GitHub y Azure DevOps pueden representar, con distinta fidelidad, el objeto externo de una Mission, su jerarquía, sus dependencias y el Pull Request de una Feature Implementation. Ninguno puede representar de forma completa ni hacer cumplir el modelo de la Factory:

- La Factory debe conservar la autoridad sobre Work Type, Workflow, estado interno, Completion Contract y Gates.
- La External Projection debe ser una vista bidireccional de mejor esfuerzo. Los webhooks son señales para volver a leer el recurso, no un registro ordenado ni una fuente de verdad.
- Una relación padre-hijo se proyecta como sub-issue en GitHub y como Parent/Child en Azure Boards. Una dependencia se proyecta como blocked-by/blocking en GitHub y Predecessor/Successor en Azure Boards.
- La semántica de estado se degrada: GitHub ofrece esencialmente abierto/cerrado y una razón de cierre; Azure DevOps permite más estados, pero sus nombres y transiciones dependen del proceso y del Work Item Type. La Factory debe mapear estados por configuración y conservar internamente cualquier distinción que el tracker no soporte.
- Los Gates no deben delegarse al tracker. GitHub muestra dependencias pero no impide cerrar; la automatización de padres de Azure Boards tiene alcance y comportamiento insuficientes para ser un Completion Contract.
- Una Feature Implementation se completa únicamente tras confirmar que su Pull Request fue integrado. Un PR cerrado, abandonado, en cola o con un intento de merge no basta.
- Para tolerar pérdidas, duplicados y desorden, cada evento debe deduplicarse, provocar una lectura del estado actual y complementarse con reconciliación periódica. Azure Boards ofrece revisiones y cursores más fuertes que GitHub; los PRs de ambos productos requieren sondeos adicionales.

## Matriz de capacidades

| Concepto de Factory | GitHub | Azure DevOps | Fidelidad y degradación aceptada |
|---|---|---|---|
| Mission | Issue | Work Item | Alta para identidad, título, cuerpo y enlace; los campos propios de la Factory permanecen internos. |
| Work Type | Issue Type de organización; en su ausencia, label administrado por la Factory | Work Item Type del proceso | Media. Los tipos disponibles deben descubrirse y mapearse por conexión; no se deben asumir nombres concretos. |
| Composite Mission | Parent/sub-issue | Parent/Child | Alta dentro de los límites nativos; la Factory conserva la relación aunque no pueda proyectarla. |
| Gate entre Missions | Dependencia visible | Dependency link visible; automatización parcial de padres | Baja como mecanismo de control. El Gate efectivo vive y se evalúa en la Factory. |
| Dependencia | blocked-by/blocking | Predecessor/Successor | Alta para la relación, baja para enforcement. |
| Estado de Mission | OPEN/CLOSED y razón de cierre | Estado por Work Item Type, normalizable por categoría | Media o baja. El Workflow interno no debe derivarse de un estado externo sin aplicar el mapping configurado. |
| Feature Implementation | Issue y PR vinculado | Work Item y PR asociado | Alta para el vínculo; el tracker no define por sí solo cuándo satisface el Completion Contract. |
| Integración del PR | `merged`/`merged_at` confirmado por API | `status=completed` y resultado de merge confirmado | Alta tras relectura; los eventos por sí solos no bastan. |
| Eventos | Webhooks firmados con HMAC, GUID de entrega y APIs de entregas | Service Hooks con UUID de evento, reintentos e historial | Media. Hay que asumir duplicados, huecos y desorden. Azure no documenta firma HMAC del cuerpo. |
| Reconciliación | Issues por `since`; relaciones y PRs requieren lecturas/sondeos adicionales | Revisiones y links con continuation token; PRs requieren sondeo | Alta para Boards, media para GitHub Issues y baja-media para PRs. |

## GitHub Issues y Pull Requests

### Modelado

GitHub expone sub-issues como una jerarquía nativa. Un issue puede tener hasta 100 hijos y la jerarquía alcanza ocho niveles; la API REST permite leer el padre, enumerar, añadir, quitar y reordenar hijos ([Adding sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues), [REST API for sub-issues](https://docs.github.com/en/rest/issues/sub-issues)). El campo padre es singular, por lo que encaja con una Composite Mission que posee hijos, no con pertenencia múltiple.

Las dependencias también son nativas mediante las relaciones blocking/blocked-by y tienen API REST y eventos propios ([Creating issue dependencies](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies), [REST API for issue dependencies](https://docs.github.com/en/rest/issues/issue-dependencies)). GitHub limita a 50 las relaciones de cada dirección por issue ([general availability announcement](https://github.blog/changelog/2025-08-21-dependencies-on-issues/)). Estas relaciones comunican orden y bloqueo, pero no constituyen un Gate de cierre: la Factory debe seguir impidiendo la transición interna aunque GitHub permita cerrar el issue padre.

Los Issue Types pertenecen a la organización, admiten hasta 25 tipos y parten de Task, Bug y Feature; pueden editarse, deshabilitarse o eliminarse. No están disponibles de igual manera en repositorios personales ([Managing issue types in an organization](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/managing-issue-types-in-an-organization), [REST API for organization issue types](https://docs.github.com/en/rest/orgs/issue-types)). Por ello, el mapping de Work Type debe descubrir capacidades al configurar la conexión. Si no existe un tipo equivalente, la proyección puede usar un label reservado y conservar el Work Type canónico en la Factory.

El estado nativo de un issue es OPEN o CLOSED. La razón de cierre distingue COMPLETED, NOT_PLANNED y DUPLICATE, pero no reproduce un Workflow de varias etapas ([GraphQL Issue reference](https://docs.github.com/en/graphql/reference/issues)). Estados internos como discusión, investigación, preparación o espera deben mantenerse internamente; proyectarlos como labels es opcional y no debe convertir esos labels en autoridad.

Los PRs se vinculan a issues manualmente o mediante palabras clave. Una palabra clave puede cerrar el issue automáticamente al integrar el PR en la rama por defecto, y el vínculo manual admite hasta diez issues por PR ([Linking a pull request to an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)). La Factory debería preferir un vínculo que no cierre automáticamente mientras el Completion Contract no esté satisfecho. La API distingue PR cerrado de PR integrado mediante `merged` y `merged_at`; `closed` por sí solo no implica éxito ([REST API for pull requests](https://docs.github.com/en/rest/pulls/pulls)).

### Eventos e identidad

Cada entrega webhook incluye `X-GitHub-Delivery`, un GUID globalmente único, además de `X-GitHub-Hook-ID`, `X-GitHub-Event` y `X-Hub-Signature-256`. La firma es HMAC SHA-256 sobre el cuerpo original ([Webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)). La clave de deduplicación recomendada es conexión/hook más GUID de entrega; una redelivery conserva el GUID aunque genere una nueva entrada de entrega ([GitHub App webhook deliveries API](https://docs.github.com/en/rest/apps/webhooks)).

Los eventos relevantes incluyen `issues`, `issue_comment`, `sub_issues`, `issue_dependencies`, `pull_request`, `pull_request_review` y `pull_request_review_comment`. El payload debe guardarse sin mutar para auditoría, validarse antes de procesar y responderse con rapidez; después, un worker relee el recurso afectado. GitHub limita el payload a 25 MB y no entrega el evento si lo supera ([Webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)).

GitHub no reintenta automáticamente una entrega fallida. Se puede consultar y solicitar redelivery mediante API, pero esto sirve para recuperación operativa, no sustituye reconciliar el estado actual ([Handling failed webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries), [GitHub App webhook deliveries API](https://docs.github.com/en/rest/apps/webhooks)). Tampoco hay una garantía documentada de orden global; dos eventos relacionados deben poder llegar duplicados o invertidos sin corromper el modelo.

### Reconciliación

Para Issues, el listado REST admite `since` sobre `updated_at`, estado `all`, ordenación y paginación de hasta 100 elementos. Ese endpoint también devuelve PRs y exige distinguirlos por la clave `pull_request` ([REST API for issues](https://docs.github.com/en/rest/issues/issues)). Se recomienda mantener un cursor temporal con solapamiento, paginar hasta cubrirlo y reconsultar por separado padre, hijos y dependencias de las Missions compuestas o activas.

Para PRs no hay un cursor `since` equivalente en el listado. La reconciliación debe enumerar todos los PRs activos, consultar por ID los PRs conocidos que esperan resolución y barrer una ventana solapada de cerrados ordenada por actualización ([REST API for pull requests](https://docs.github.com/en/rest/pulls/pulls)). El estado de integración se confirma leyendo el PR; no se infiere de un evento `closed` ni de que los checks estén verdes.

La timeline de un issue aporta eventos identificados y referencias cruzadas, útil para diagnóstico, pero la reconciliación debe comparar snapshots actuales, no intentar reconstruir la verdad exclusivamente desde el historial ([REST API for issue timeline](https://docs.github.com/en/rest/issues/timeline), [Issue event types](https://docs.github.com/en/rest/using-the-rest-api/issue-event-types)).

## Azure DevOps Boards y Pull Requests

### Modelado

Azure Boards modela el trabajo mediante Work Item Types definidos por el proceso. Basic, Agile, Scrum y CMMI difieren en nombres y jerarquías; una jerarquía habitual es Epic → Feature → Requirement/User Story/Product Backlog Item/Issue → Task, y el nivel de Bug es configurable ([About work items and work item types](https://learn.microsoft.com/en-us/azure/devops/boards/work-items/about-work-items?view=azure-devops)). La Factory debe consultar los tipos y estados del proyecto mediante API y guardar un mapping por conexión, en vez de asumir que “Feature” o “User Story” existen con semántica fija ([Work Item Types - List](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-item-types/list?view=azure-devops-rest-7.1)).

Los estados concretos también varían, pero Azure los agrupa en Proposed, In Progress, Resolved, Completed y Removed ([Workflow states and state categories](https://learn.microsoft.com/en-us/azure/devops/boards/work-items/workflow-and-state-categories?view=azure-devops)). Estas categorías son una base mejor para el mapping que el nombre visible, aunque siguen siendo más gruesas que un Workflow de Factory.

Parent/Child usa los enlaces `System.LinkTypes.Hierarchy-Forward/-Reverse`, con topología de árbol, prevención de ciclos y un solo padre. Predecessor/Successor usa `System.LinkTypes.Dependency-Forward/-Reverse`. La API permite descubrir los relation types y propiedades como `acyclic` o `singleTarget` ([Link type reference](https://learn.microsoft.com/en-us/azure/devops/boards/queries/link-type-reference?view=azure-devops), [Work Item Relation Types - List](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-item-relation-types/list?view=azure-devops-rest-7.1)). Esto cubre bien las relaciones de Composite Mission y Prerequisite Task, pero la visualización puede degradarse con jerarquías del mismo nivel o proyectos con procesos distintos ([Backlogs overview](https://learn.microsoft.com/en-us/azure/devops/boards/backlogs/backlogs-overview?view=azure-devops)).

Azure Boards ofrece reglas opcionales para cerrar un padre cuando todos los hijos se completan. No sirven como Gate canónico: solo se disparan desde determinadas vistas de Boards, no son retroactivas, no reabren el padre al reactivar un hijo y están limitadas al mismo equipo ([Automate work item state transitions](https://learn.microsoft.com/en-us/azure/devops/boards/backlogs/automate-work-item-state-transitions?view=azure-devops)). La Factory puede aprovecharlas como comodidad visual si la configuración concreta es compatible, nunca como prueba de que el Completion Contract se cumplió.

Los Work Items y PRs pueden asociarse y la API permite enumerar los work items vinculados a un PR ([Pull Request Work Items - List](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-work-items/list?view=azure-devops-rest-7.1)). Azure puede completar work items asociados al integrar un PR, pero es una opción explícita ([Complete pull requests](https://learn.microsoft.com/en-us/azure/devops/repos/git/complete-pull-requests?view=azure-devops)). La External Projection no debe activarla por defecto: podría cerrar una Mission antes de que sus Gates internos se hayan resuelto.

Un PR tiene estados active, abandoned y completed, además de `isDraft`; el resultado de merge se expone por separado y puede estar en cola, tener conflictos, fallar o ser rechazado por políticas ([Pull Requests - Get](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/get-pull-request?view=azure-devops-rest-7.1)). Para completar una Feature Implementation hay que releer el PR y confirmar integración efectiva, no aceptar abandoned ni un mero intento de merge.

### Eventos e identidad

Service Hooks expone eventos de creación, actualización, eliminación, restauración y comentario de Work Items, además de creación, actualización e intento de merge de PRs y comentarios de revisión. El envelope incluye un UUID `id`, `eventType`, `publisherId`, `createdDate`, versión del recurso e identificadores de account, collection y project; los eventos de Work Item incluyen además el `rev` del recurso ([Service Hooks events](https://learn.microsoft.com/en-us/azure/devops/service-hooks/events?view=azure-devops)). La clave de deduplicación recomendada es conexión/suscripción más `id` de evento.

El evento llamado `git.pullrequest.merged` representa un intento de merge y permite resultados como succeeded, conflicts, failure o rejected by policy. Por tanto, incluso ese evento solo debe despertar una lectura del PR. `git.pullrequest.updated` cubre cambios de estado, votos y pushes a la rama fuente ([Service Hooks events](https://learn.microsoft.com/en-us/azure/devops/service-hooks/events?view=azure-devops)).

Azure reintenta errores transitorios seleccionados hasta ocho veces con backoff y conserva durante siete días el historial detallado de request/response; errores persistentes pueden poner la suscripción en probation o deshabilitarla ([Troubleshoot service hooks](https://learn.microsoft.com/en-us/azure/devops/service-hooks/troubleshoot?view=azure-devops)). La API de notificaciones expone `eventId`, intentos y resultado, útil para health checks y diagnóstico ([Notifications - List](https://learn.microsoft.com/en-us/rest/api/azure/devops/hooks/notifications/list?view=azure-devops-rest-7.1)). No es un log duradero desde el que reconstruir el dominio.

Hay una diferencia de seguridad importante respecto a GitHub: la documentación oficial del consumidor Web Hooks documenta HTTPS, Basic Authentication y headers estáticos, pero no una firma HMAC del cuerpo por entrega. Además advierte que los headers configurados son visibles para usuarios con permiso de ver la suscripción ([Service Hooks consumers](https://learn.microsoft.com/en-us/azure/devops/service-hooks/consumers?view=azure-devops)). En la primera versión se debe autenticar el endpoint con un secreto dedicado por suscripción sobre TLS, limitar origen cuando sea viable, rotarlo y tratar el payload como no firmado. No debe describirse Azure Service Hooks como equivalente criptográfico a `X-Hub-Signature-256`.

### Reconciliación

Work Items dispone de una base robusta para reconciliación incremental:

- La Reporting Work Item Revisions API devuelve revisiones por lotes con `continuationToken`, `rev`, `ChangedDate` y opción de incluir eliminados ([Reporting Work Item Revisions](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/reporting-work-item-revisions/read-reporting-revisions-get?view=azure-devops-rest-7.1)).
- La Reporting Work Item Links API devuelve altas y bajas de relaciones con su propio continuation token, `changedDate` e `isActive` ([Reporting Work Item Links](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/reporting-work-item-links/get?view=azure-devops-rest-7.1)).
- Las updates de un Work Item permiten inspeccionar deltas entre revisiones ([Work Item Updates - List](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/updates/list?view=azure-devops-rest-7.1)).
- Una escritura puede usar JSON Patch con una operación `test` sobre `/rev`, evitando sobrescribir silenciosamente una edición concurrente ([Work Items - Update](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/update?view=azure-devops-rest-7.1)).

El bootstrap puede usar WIQL para seleccionar el alcance y después leer IDs por lotes; los endpoints de Work Items aceptan como máximo 200 por batch ([WIQL - Query By WIQL](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/wiql/query-by-wiql?view=azure-devops-rest-7.1), [Work Items REST API](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items?view=azure-devops-rest-7.1)). Cada conexión debe persistir por separado el watermark de revisiones y el de links, avanzándolos solo tras aplicar el lote de forma transaccional.

Los PRs son menos cómodos. El listado filtra por status y por ventanas basadas en fecha de creación o cierre, pero no ofrece un cursor general de última modificación ([Pull Requests - Get Pull Requests](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/get-pull-requests?view=azure-devops-rest-7.1)). La reconciliación debe enumerar todos los activos, consultar por ID los PRs conocidos y barrer una ventana solapada de completados/abandonados. La API de Service Hooks ayuda a detectar fallos, pero no elimina esta necesidad.

## Contrato recomendado para External Projection

### Procesamiento de eventos

1. Verificar autenticidad con el cuerpo sin transformar: HMAC en GitHub; secreto de endpoint/Basic Auth sobre TLS en Azure.
2. Persistir envelope, headers relevantes, payload, instante de recepción y clave de deduplicación antes de responder.
3. Responder 2xx rápidamente y procesar fuera de la petición.
4. Convertir el evento en una orden de refresco por recurso, no en una transición de dominio directa.
5. Leer el snapshot actual y aplicarlo de forma idempotente. En Azure Boards, ignorar revisiones menores o iguales a la última observada; en GitHub y en PRs de Azure, comparar snapshot/fingerprint y aceptar coalescencia.
6. Evaluar mappings, Gates y Completion Contracts dentro de la Factory.
7. Registrar drift si el cambio externo no puede importarse sin contradecir una ejecución activa o una regla interna.

Procesar siempre los eventos producidos por la propia Factory. Para evitar bucles no se debe ignorar al actor: se compara estado deseado y observado, se guarda la operación saliente y solo se escribe otra vez si persiste una diferencia reparable.

### Reconciliación periódica

Cada conexión necesita tres frecuencias distintas:

- rápida para recursos activos o con una operación saliente pendiente;
- normal para el alcance gestionado y sus relaciones;
- auditoría lenta para detectar eliminaciones, permisos perdidos, suscripciones deshabilitadas y recursos que dejaron de aparecer.

Los cursores deben llevar solapamiento y no avanzar si falla un lote. La reconciliación compara tanto campos como relaciones; reparar únicamente título o estado y omitir Parent/Child o dependencias dejaría los Gates visualmente incoherentes.

### Política de drift

| Clase | Ejemplo | Respuesta recomendada |
|---|---|---|
| Reparable | Falta un label administrado o una relación que la Factory puede volver a crear sin ambigüedad | Reaplicar de forma idempotente y registrar el intento. |
| Importable | El operador cambia título, descripción o una relación válida que no contradice trabajo activo | Importar según el mapping y actualizar la versión observada. |
| Conflictivo | Se cierra una Composite Mission con hijos abiertos; se cambia una dependencia durante ejecución; dos lados cambian de forma incompatible | Mantener el estado canónico, pausar la automatización afectada y pedir resolución al Operator. |
| No representable | Se supera un límite, falta un Issue Type, permisos insuficientes o el tracker impide una relación | Conservar el modelo interno, marcar la proyección degradada y mostrar causa y posible remediación. |
| Desaparecido | Issue/Work Item eliminado, repositorio inaccesible o proyecto movido | No eliminar la Mission; marcar la proyección desconectada y permitir re-vincular. |

## Decisiones que esta investigación deja listas

1. Adoptar la Factory como autoridad y External Projection como réplica bidireccional de mejor esfuerzo.
2. Usar sub-issues y Parent/Child para Composite Missions; issue dependencies y Predecessor/Successor para Gates/dependencias visibles.
3. Evaluar Gates exclusivamente en la Factory. Las automatizaciones nativas de cierre son ayudas opcionales y deben estar desactivadas por defecto.
4. Descubrir y configurar el mapping de Work Types y estados por conexión. Nunca codificar un proceso de Azure ni asumir Issue Types de GitHub disponibles.
5. Completar una Feature Implementation solo después de confirmar por API que el PR está integrado.
6. Tratar todos los webhooks como señales al menos una vez: deduplicar, releer, reconciliar y auditar la salud de la suscripción.
7. Implementar watermarks separados para revisiones y links de Azure Boards; para GitHub y los PRs, usar ventanas solapadas, paginación y lecturas por ID de recursos activos.
8. Documentar explícitamente la degradación de seguridad de Azure Service Hooks: autenticación por secreto/TLS, sin asumir una firma HMAC de payload que Microsoft no documenta.
9. Hacer visible el drift y reservar al Operator la resolución de conflictos semánticos; nunca forzar una sincronización destructiva automática.

## Riesgos que permanecen abiertos

- La disponibilidad de Issue Types, sub-issues, dependencias y algunas operaciones depende del plan, organización y permisos de GitHub. La conexión debe hacer capability discovery y degradar de forma explícita.
- Los procesos personalizados de Azure pueden añadir estados, reglas y Work Item Types incompatibles con un mapping predefinido.
- Las APIs de PR no ofrecen un stream incremental tan sólido como las revisiones de Azure Boards; el coste y la cadencia de polling deberán medirse con repositorios reales.
- Límites, previews y payloads pueden cambiar. Las integraciones deben fijar versión de API, registrar la versión observada y probar contracts contra fixtures de ambos proveedores.
