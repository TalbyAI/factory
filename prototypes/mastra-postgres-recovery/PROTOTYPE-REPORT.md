# Mastra + PostgreSQL recovery prototype

## Question

Can pinned Mastra Workflows plus minimal Factory guards survive HITL suspension, process crashes, resume, retries, Workflow upgrades, concurrent recovery and child Missions without duplicating effective actions?

## Setup

- Node.js 24.20.0 on Linux containers
- PostgreSQL 17
- `@mastra/core` 1.64.0
- `@mastra/pg` 1.22.3
- Separate disposable schemas: `prototype_factory` and `prototype_mastra`
- External effects represented by an independently committed Factory row with a stable idempotency key

Run from this directory:

```sh
docker compose run --build --rm prototype
```

The complete harness was run successfully three consecutive times after the discovery assertion was corrected.

## Results

| Scenario | Result | Evidence |
|---|---|---|
| HITL suspension and child Mission | Validated | A fresh process loaded the suspended Run by its Factory-owned `RunId`; after the child became `Completed`, resume finished the same Run without polling. |
| SIGKILL after an effect | Validated | Recovery executed the interrupted step twice but the idempotency key produced one effective action. |
| Retry budget after crash | Validated with Factory guard | Mastra retry counters were `0, 1, 2, 0`: the local budget reset after restart. The durable Factory counter rejected execution 4 as non-retryable. |
| Workflow upgrade | Validated with Factory guard | A `2.0.0+b` worker was rejected without changing a Run pinned to `1.0.0+a`; the matching worker resumed it successfully. |
| Concurrent resume | Validated | Exactly one resume succeeded and executed one effect. The loser sometimes surfaced `This workflow run was not suspended`, so Factory must reconcile state rather than depend on one conflict code. |
| Concurrent restart | Validated with Factory guard | A per-Run PostgreSQL advisory lock produced one recovery winner and one excluded process; the effective action remained unique. |
| SIGTERM | Validated | The worker handled SIGTERM, closed its resources, and a new process/createRun/restart cycle completed the same Run. The active step executed again. |
| Snapshot growth | Measured | Snapshots were about 1,007 bytes for 1 step, 1,329 for 10, and 9,516–9,518 for 50; observed execution time was 34–320 ms. These are measurements, not performance guarantees. |
| Joint backup/restore | Validated | Restoring both schemas preserved 10 Mastra snapshots, 7 Factory Runs and 3 effects; restore took 324–344 ms in the scratch environment. |

## Findings for the Factory design

1. Mastra provides durable checkpoints, not exactly-once execution. Every effectful step may replay after SIGTERM or SIGKILL.
2. Stable idempotency keys and durable effect records are mandatory; a successful Mastra retry is not proof that an external action occurred only once.
3. The durable Attempt budget belongs to Factory. Mastra's in-process `retryCount` restarts from zero after process recovery.
4. Factory must reject resume/restart before invoking Mastra when the worker does not provide the Run's pinned `workflowVersion`.
5. `listActiveWorkflowRuns()` lists `running` and `waiting`, but not `suspended`. Factory must retain each `RunId` and load suspended Runs explicitly through Mastra's public API.
6. Resume has a PostgreSQL claim; restart does not. The local-first topology needs a Factory-owned per-Run lock around restart.
7. Factory and Mastra data must be backed up and restored as one logical unit even though their schemas remain separately owned.

## Limits

- The effect sink is deterministic and local; live GitHub and Azure DevOps smoke tests remain part of the tracer bullet.
- The prototype uses one database role and one local Mastra Server topology. Production role separation and multi-replica leader election are not tested.
- Snapshot measurements are indicative only; no throughput or long-duration retention claim is made.
- Only the successful `Completed` child-Mission path is exercised. Denied and waived `Cancelled` Mission Gate semantics were already fixed by the domain model and are not reopened here.

## Proposed verdict

**Validated, conditionally.** Mastra Workflows with PostgreSQL are viable for the local-first tracer bullet if Factory supplies durable idempotency, Attempt budgets, Workflow version checks, explicit suspended-Run lookup and per-Run restart locking. None of those safeguards can be delegated to Mastra.
