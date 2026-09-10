# Topology Factory prototype report

## Verdict

**Validated** on `ef67176271bb78e3bf75e6e039201ed0453c0b3d`.

The current full assert-based run exited 0. Its intentional lack of progress
logging means the command output is limited to the npm script banner; the
evidence below is the set of assertions completed in that run, not invented
event identifiers.

## Environment observed

| Component | Exact version |
| --- | --- |
| Node.js | `v24.14.1` |
| PostgreSQL | `PostgreSQL 17.11 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit` |
| `@mastra/core` | `1.64.0` |
| `@mastra/pg` | `1.22.3` |
| `pg` | `8.16.3` |
| `zod` | `4.1.8` |

The manifest has no TanStack, CopilotKit, or AG-UI package: this is a minimal
Node HTTP/SSE topology harness, not an official client integration.

## Commands and observations

Commands run from this directory:

```sh
node --check src/self-check.mjs
npm run self-check
docker compose exec -T postgres psql -U prototype -d topology_prototype -Atc "select version()"
```

`node --check` was silent and exited 0. `npm run self-check` exited 0 with
this complete output:

```text
> self-check
> node src/self-check.mjs
```

The self-check started its owned supervisor, verified both child health
endpoints, then stopped its owned supervisor and children and reset only the
scratch schemas. PostgreSQL was already running under this prototype's Compose
project and was left running.

| Scenario | Result | Observed evidence |
| --- | --- | --- |
| Happy path: stable identity and one effect | Passed | `POST /api/runs` returned 200; suspension and completion each asserted the original `runId`; the scratch-only query `select count(*) from topology_factory.effects` returned `1`. |
| Missing operator key | Passed | `POST /api/runs/:runId/commands` returned 401. |
| Duplicate approval | Passed | Repeating `approve-1` returned 200 and the same scratch-only effect query remained `1`. |
| Reconnect/no replay after completion | Passed | `nextEvents` advanced its local cursor to the received sequence; reading after `completed.sequence` returned `undefined` after 250 ms, and BFF `/health` remained 200 after the SSE client disconnect. |
| Independent BFF restart and replay | Passed | A second Run suspended, `POST /admin/restart/bff` returned 202, BFF health recovered, and reconnecting from cursor `0` returned that original Run's `workflow.suspended` event and `runId`. |
| Mastra restart, approval, and completion | Passed | A third Run suspended, `POST /admin/restart/mastra` returned 202, Mastra health recovered, approval with `approve-3` returned 200, and reading after the pre-restart suspension cursor returned `workflow.completed` with the original `runId`. |

Mastra wire events name suspension `workflow-step-suspended` and successful
completion `workflow-finish` with `workflowStatus: "success"`. The self-check
maps only those two wire forms to the brief's semantic
`workflow.suspended`/`workflow.completed` names while retaining the stored
`runId` and `sequence`. `nextEvents` owns a local cursor, moves it to the
maximum sequence of each parsed event, and uses that cursor for each reconnect.

## Prior refutation and revalidation

An intermediate run was correctly **refuted**: closing the no-replay SSE
client caused BFF's upstream fetch to throw `AbortError`, BFF health became
unavailable, and the self-check stopped before restart scenarios. The approved
SSE fix in `d2f60aa`, `a9e823f`, and `ef67176` corrected that behavior. The
fresh full run recorded above re-executed the disconnect assertion and both
restart scenarios successfully; the current verdict therefore reflects the
latest evidence.

## Browser token observation

`public/index.html` contains the operator key but no occurrence of
`prototype-service-token`; server-to-server requests in `bff.mjs` add that
token. This is source-level evidence only, not a browser security audit.

## Limits

- Throwaway evidence only; it is not Factory runtime code.
- No load, multi-replica, PostgreSQL failover, real external provider, or
  compromised-host security testing.
- No official TanStack, CopilotKit, or AG-UI integration is installed here.
- The report does not claim token-perfect AG-UI replay or exactly-once external
  effects; the only effect is a local idempotent PostgreSQL row.
- The scratch database is intentionally destructive: use only
  `topology_prototype` on port 55433, and never aim `DATABASE_URL` at a
  non-disposable database. `docker compose down -v` deletes its prototype
  volume permanently.
