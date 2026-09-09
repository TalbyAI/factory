# PROTOTYPE — Mastra recovery with PostgreSQL

This throwaway harness asks whether pinned Mastra Workflows plus the smallest Factory-owned guards can preserve one `RunId` across suspension, process death, resume and retry without duplicating an effective external action.

It runs seven real PostgreSQL scenarios: child-Mission suspension, SIGKILL recovery, durable retry limits, Workflow version mismatch, concurrent resume/restart, SIGTERM recovery, and snapshot backup/restore. The “external” effect is a separate committed transaction in the scratch Factory schema with a stable idempotency key; no GitHub or Azure DevOps resource is changed.

Run it from this directory:

```sh
docker compose run --build --rm prototype
docker compose down -v
```

The harness refuses to reset any database not named `factory_prototype`. Both `prototype_factory` and `prototype_mastra` are disposable.
