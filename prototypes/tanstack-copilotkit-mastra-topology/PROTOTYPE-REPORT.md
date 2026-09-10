# Topology Factory prototype report

## Verdict

**Validated** on executable commit `228e252526c9138ea630098228c00cb40a6fed0c`
(the current code HEAD before this evidence-only update; it contains
`e8f618b`). The full assert-based check completed with exit 0 on 2026-09-10.

The command emits only its npm banner plus Compose readiness. The scenario
results below are assertions that completed in that run; no event identifiers
or unobserved browser behavior is inferred.

## Environment observed

| Component | Exact version / state |
| --- | --- |
| Host | Windows `10.0.26200.0`, PowerShell `7.6.6` |
| Node.js | `v24.14.1` |
| PostgreSQL | `PostgreSQL 17.11 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit` |
| Compose database | `topology_prototype` as `prototype`; `postgres:17-alpine`, healthy |
| `@mastra/core` | `1.64.0` |
| `@mastra/pg` | `1.22.3` |
| `pg` | `8.16.3` |
| `zod` | `4.1.8` |

The manifest has no TanStack, CopilotKit, or AG-UI package. This is a minimal
Node HTTP/SSE topology harness, not an official client integration.

## Commands and output observed

All commands below ran from `prototypes/tanstack-copilotkit-mastra-topology`,
except the repository-relative `git -C ..\\..` check.

```powershell
$modules = Get-ChildItem -File src -Filter '*.mjs' | Sort-Object Name
$modules | ForEach-Object { node --check $_.FullName }
npm run self-check
git -C ..\\.. diff --check
node --version
npm ls --depth=0
docker compose exec -T postgres psql -U prototype -d topology_prototype -Atc "select version()"
```

`node --check` was silent and exited 0 for all relevant modules:
`bff`, `config`, `db`, `mastra-server`, `mastra-workflow`, `protocol`,
`self-check`, and `supervisor`. `git diff --check` exited 0. The full check
output was:

```text
> self-check
> node src/self-check.mjs

 Container tanstack-copilotkit-mastra-topology-postgres-1 Running
 Container tanstack-copilotkit-mastra-topology-postgres-1 Waiting
 Container tanstack-copilotkit-mastra-topology-postgres-1 Healthy
self-check-exit=0
```

## Scenario evidence

| Scenario | Result | Observed assertion/evidence |
| --- | --- | --- |
| Malformed input and invalid cursors | Passed | `null` and `{` to Mastra start/resume and BFF approval returned 400; `after=2147483648` returned 400 for BFF and Mastra. Both `/health` endpoints remained 200. |
| Happy path and operator authorization | Passed | The Run suspended and completed with its original `runId`; approval returned 200; scratch effects count was 1. Missing operator key returned 401. |
| Duplicate approval | Passed | Repeating `approve-1` returned 200 without increasing the scratch effects count above 1; a different stale key returned 409. |
| Failed workflow/effect recovery without satisfying the Gate | Passed | A seeded effect plus durable `workflow-finish` with `failed` status produced a non-200 recovery response; command count remained 1 and unaccepted, Gate remained `pending`, and Mission status became `failed`. The terminal SSE response completed within 2 seconds. |
| Pending reservation retry | Passed | A preseeded unaccepted reservation survived a BFF restart; retrying its same key returned 200, then one command and one effect existed for that Run. |
| 10 simultaneous same-key approvals | Passed | All 10 responses were 200 within the 5-second deadlock bound; the Run completed with exactly one command and one effect. |
| 12 parallel Runs | Passed | Start, suspension, approval, and completion each met their 10-second bounds; every Run preserved its own `runId` and had one command and one effect. |
| SSE after live/pending event | Passed | A Run first yielded `workflow.suspended`; after its pending sequence, the same Run yielded `workflow.completed`. A pending Run replayed `workflow.suspended` from cursor 0 after a BFF restart; a pending Run also completed after a Mastra restart and approval. |
| SSE after completion and disconnect | Passed | Reading after `completed.sequence` yielded no event within 250 ms; after the client disconnect, BFF `/health` was still 200. |
| Shutdown with open SSE, no prototype listener left | Passed | With a live SSE open, supervisor shutdown completed within 2.5 seconds; the self-check then successfully bound loopback ports 4310, 4311, and 4312 before cancelling the client stream. |
| Readiness and loopback | Passed | Compose reported PostgreSQL healthy; self-check waited for BFF and Mastra health. BFF, Mastra, and supervisor are configured to listen on `127.0.0.1` ports 4310, 4311, and 4312. |

Mastra wire events use `workflow-step-suspended` and `workflow-finish` with
`workflowStatus: "success"`. The self-check maps only those forms to the
semantic `workflow.suspended` and `workflow.completed` names while retaining
the stored `runId` and sequence.

## Final process, port, and cleanup state

Immediately after the check, the listener query found no listeners on 4310,
4311, or 4312. The only prototype listener was:

```text
127.0.0.1:55433  pid=17564  process=com.docker.backend
```

`docker compose ps` reported PostgreSQL `Up (healthy)`. The only remaining
`node.exe` processes were Codex app-server and GitNexus MCP commands, not
prototype commands. The self-check had left the pre-existing PostgreSQL
container running, reset only `topology_factory` and `topology_mastra`, and
the observed database remained `topology_prototype:prototype`.

## Source-level observations

`public/index.html` had no `prototype-service-token` occurrence; the seven
observed service-token references were server-side in BFF/Mastra code. This is
source-level evidence, not a browser security audit.

The README's clean-checkout command is exactly:

```sh
npm ci && docker compose up -d --wait postgres && npm run self-check && npm run prototype
```

It was inspected, not executed from a newly cloned checkout. The executed
command here was the standalone `npm run self-check` above.

## Prior SSE refutation and revalidation

An earlier run was correctly refuted: closing a no-replay SSE client raised
`AbortError` in BFF and made its health endpoint unavailable. The subsequent
SSE handling change was revalidated by this fresh run: no replay after the
completion cursor, BFF health after client disconnect, BFF replay while
pending, and shutdown with an open SSE all passed.

## Limits

- The BFF approval lock is a single-process in-memory `Map`; it is not a
  multi-replica coordination mechanism.
- No load, multi-replica, PostgreSQL failover, real external provider, or
  compromised-host security test was run.
- The effect is one local idempotent PostgreSQL row; this does not establish
  exactly-once external effects or token-perfect AG-UI replay.
- Cleanup is deliberately scratch-only and refuses a database other than
  `topology_prototype`; `docker compose down -v` permanently deletes its
  prototype volume.
- GNU Bash `5.2.21` is available on this Windows host, so a no-POSIX
  Windows-only limitation was not observed. A separate POSIX-host run was not
  performed and is therefore inconclusive.
