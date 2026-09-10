# Prototype Report: Factory Operator Experience

## Hipótesis

Un Workspace Inbox-first permite al Operator identificar la siguiente Mission que requiere atención, inspeccionar su contexto operativo y ejecutar una acción recomendada simulada sin recurrir a chat.

## Walkthrough de aceptación

1. **Human Gate pendiente** — `mission-feature-gate` aparece primero por `attentionRank`, muestra la situación `Waiting on Human Gate`, la Run y el Gate pendiente, y ofrece `Approve the export scope gate` como acción simulada con la autoridad requerida.
2. **Dependencia bloqueada** — `mission-feature-implementation` muestra `Blocked dependency`; la pestaña Dependencies expone `Invoice fixtures` como `Blocked` y la acción recomendada permite simular el desbloqueo.
3. **Review en ejecución** — `mission-pr-review` muestra la Run `Running`; Timeline, Gates y Evidence exponen el review, sus checks y la evidencia disponible, con inspección local como acción recomendada.
4. **Mission preparada** — `mission-change-proposal` muestra la situación y Run `Ready`, el Gate de mantenimiento y el Runbook verificado antes de simular `Start the change run`.
5. **Run fallida con Projection Drift** — `mission-bug-drift` conserva la Mission `Open`, muestra la Run `Failed`, la situación `Stalled` y el detalle completo de Projection Drift en Overview antes de simular la reconciliación.

## Evidencia observada

- Inspección estática de `public/index.html`: el Inbox ordena por `attentionRank` y después por `id`, conserva todas las Missions y separa selección, tabs y actividad en el estado de memoria aprobado.
- Las cinco pestañas renderizan los registros sembrados; Overview incluye situación operativa, Run, Execution Frontier, conteos de Missions hijas/dependencias, Gates, Artifacts y Projection Drift.
- La barra presenta una acción recomendada simulada y acciones secundarias de inspección. `simulateAction()` sólo añade actividad local con el resultado `simulated — no external effect`.
- La única carga de red declarada es el `fetch('/data.json')` inicial; ningún manejador de selección, tabs o acciones invoca endpoints.
- `npm run check`, `npm run self-check` y la validación sintáctica del script inline finalizaron correctamente durante la implementación.

## Resultado

**inconclusive**

La implementación hace observables los cinco escenarios sin chat, pero no se asigna `validated` porque el walkthrough manual en navegador no se completó: la conexión de navegador no estuvo disponible y se indicó finalizar sin esperar interacción manual.

## Límites

- Prototipo descartable, sin persistencia, backend operativo ni servicios externos.
- Toda acción queda en memoria del navegador y se pierde al recargar.
- No ejecuta Privileged Actions, no modifica Targets y no concede Autonomy Grants.
- El resultado no cubre una comprobación visual manual de responsive layout, navegación por tabs ni actividad simulada.
