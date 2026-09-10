# Prototype Report: Factory Operator Experience

## Hipótesis

Un Workspace Inbox-first permite al Operator identificar la siguiente Mission que requiere atención, inspeccionar su contexto operativo y ejecutar una acción recomendada simulada sin recurrir a chat.

## Walkthrough de aceptación

1. **A1 — Human Gate pendiente** — `mission-feature-gate` aparece primero por `attentionRank`, muestra la situación `Waiting`, el Gate pendiente y ninguna Run iniciada, y permite simular `Approve the export scope gate` con aprobación exacta del Operator.
2. **A2 — Dependencia bloqueada** — `mission-feature-implementation` muestra la situación `Waiting`, la Execution Frontier `blocked` y la dependencia `Invoice fixtures` como `Blocked`; permite simular el desbloqueo con `Autonomy Grant`.
3. **A3 — Review en ejecución** — `mission-pr-review` muestra la Run `Running`; Timeline, Gates y Evidence exponen el review, sus checks y la evidencia disponible, y permite simular la inspección de evidencia local.
4. **A4 — Mission preparada** — `mission-change-proposal` muestra la situación `Ready`, ninguna Run iniciada, el Gate de mantenimiento `Satisfied` y el Runbook verificado antes de simular `Start the change run` con `Autonomy Grant`.
5. **A5 — Run fallida con Projection Drift** — `mission-bug-drift` conserva la Mission `Open`, muestra la Run `Failed`, la situación `Stalled` y el detalle completo de Projection Drift en Overview; su acción primaria permanece deshabilitada porque el Gate está `Pending`.

## Evidencia observada

- Inspección estática de `public/index.html`: el Inbox ordena por `attentionRank` y después por `id`, conserva todas las Missions y separa selección, tabs y actividad en el estado de memoria aprobado.
- La atención queda ordenada como `mission-feature-gate`, `mission-bug-drift`, `mission-feature-implementation`, `mission-pr-review`, `mission-change-proposal`.
- La Feature compuesta enlaza la Mission padre con sus dos hijas; Overview renderiza la Execution Frontier derivada (`blocked`, `waiting` o `eligible`) junto con su razón y no presenta una dependencia bloqueada como elegible.
- Las cinco pestañas renderizan los registros sembrados; Overview incluye situación operativa, Run, Execution Frontier, conteos de Missions hijas/dependencias, Gates, Artifacts y Projection Drift.
- Timeline, Gates y Evidence muestran IDs estáticos y referencias de Run, Gate, Artifact, Dependency y Projection Drift, incluyendo evidencia de Gate versionada y Artifacts inmutables con revisión.
- La barra presenta una acción recomendada simulada con autoridad explícita y controles secundarios etiquetados como inspecciones simuladas. `simulateAction()` sólo añade actividad local con el resultado `simulated — no external effect`.
- La única carga de red declarada es el `fetch('/data.json')` inicial; ningún manejador de selección, tabs o acciones invoca endpoints.
- Tras `bae0aa1`, el walkthrough en navegador confirmó el orden `mission-feature-gate`, `mission-bug-drift`, `mission-feature-implementation`, `mission-pr-review`, `mission-change-proposal`; las cinco pestañas tuvieron contenido, A1–A4 produjeron actividad simulada local y A5 permaneció deshabilitada por su Gate `Pending`.
- `npm run check`, `npm run self-check` y `git diff --check` finalizaron correctamente.

## Resultado

**validated**

El walkthrough manual en navegador completó los cinco escenarios sin chat. Se observaron la selección de Missions, el cambio de tabs, las acciones simuladas locales y el bloqueo de seguridad de A5.

## Límites

- Prototipo descartable, sin persistencia, backend operativo ni servicios externos.
- Toda acción queda en memoria del navegador y se pierde al recargar.
- No ejecuta Privileged Actions, no modifica Targets y no concede Autonomy Grants.
- No se realizó una comprobación visual manual del layout responsive.
