# Prototype Report: Factory Operator Experience

## Hipótesis

Un Workspace Inbox-first permite al Operator identificar la siguiente Mission que requiere atención, inspeccionar su contexto operativo y ejecutar una acción recomendada simulada sin recurrir a chat.

## Walkthrough de aceptación

1. **A1 — Human Gate pendiente** — `mission-feature-gate` aparece primero por `attentionRank`, muestra la situación `Waiting`, el Gate pendiente y ninguna Run iniciada, y permite simular `Approve the export scope gate` con aprobación exacta del Operator.
2. **A2 — Dependencia bloqueada** — `mission-feature-implementation` muestra la situación `Waiting`, la Execution Frontier `blocked` y la dependencia `Customer export fixtures` como `Blocked`; su `External Gate` `Export implementation checks` está `Satisfied`, con evidencia y Artifact `Verified`, y permite simular el desbloqueo con `Autonomy Grant`.
3. **A3 — Review en ejecución** — `mission-pr-review` muestra la Run `Running`; Timeline, Gates y Evidence exponen el review, sus checks y la evidencia disponible, y permite simular la inspección de evidencia local.
4. **A4 — Propuesta preparada** — `mission-change-proposal` muestra la situación `Ready`, ninguna Run iniciada, el Gate de completitud `Satisfied` y la propuesta de rotación de credenciales verificada antes de simular `Inspect the change proposal` como inspección local.
5. **A5 — Run fallida con Projection Drift** — `mission-bug-drift` conserva la Mission `Open`, muestra la Run `Failed`, la situación `Waiting`, la etiqueta `Failed Run intervention` y el detalle completo de Projection Drift en Overview; su acción primaria permanece deshabilitada porque el Gate está `Pending`.

## Evidencia observada

- Inspección estática de `public/index.html`: el Inbox ordena por `attentionRank` y después por `id`, conserva todas las Missions y separa selección, tabs y actividad en el estado de memoria aprobado.
- La atención queda ordenada como `mission-feature-gate`, `mission-bug-drift`, `mission-change-proposal`, `mission-feature-implementation`, `mission-pr-review`; el tercer nivel comparte `attentionRank` y usa el desempate estable por ID.
- La Feature compuesta enlaza `mission-feature-gate` únicamente con `mission-feature-implementation`; `mission-pr-review` permanece independiente. Overview renderiza la Execution Frontier derivada (`blocked`, `waiting` o `eligible`) junto con su razón y no presenta una dependencia bloqueada como elegible.
- Las cinco pestañas renderizan los registros sembrados; Overview incluye situación operativa, Run, Execution Frontier, conteos de Missions hijas/dependencias, Gates, Artifacts y Projection Drift.
- Timeline, Gates y Evidence muestran IDs estáticos y referencias de Run, Gate, Artifact, Dependency y Projection Drift, incluyendo evidencia de Gate versionada y Artifacts inmutables con revisión.
- La barra presenta una acción recomendada simulada con autoridad explícita y controles secundarios etiquetados como inspecciones simuladas. `simulateAction()` sólo añade actividad local con el resultado `simulated — no external effect`.
- La única carga de red declarada es el `fetch('/data.json')` inicial; ningún manejador de selección, tabs o acciones invoca endpoints.
- Tras `67458c4`, el walkthrough final en navegador cargó `policy.mjs`, mostró la composición, recorrió las cinco Missions y sus cinco pestañas, produjo actividad simulada local en A1–A4 y mantuvo A5 deshabilitada por su Gate `Pending`; el orden determinista actual es `mission-feature-gate`, `mission-bug-drift`, `mission-change-proposal`, `mission-feature-implementation`, `mission-pr-review`.
- `npm run check`, `npm run self-check` y `git diff --check` finalizaron correctamente.

## Resultado

**validated**

El walkthrough manual en navegador completó los cinco escenarios sin chat. Se observaron la selección de Missions, el cambio de tabs, las acciones simuladas locales y el bloqueo de seguridad de A5.

## Límites

- Prototipo descartable, sin persistencia, backend operativo ni servicios externos.
- Toda acción queda en memoria del navegador y se pierde al recargar.
- No ejecuta Privileged Actions, no modifica Targets y no concede Autonomy Grants.
- No se realizó una comprobación visual manual del layout responsive.
