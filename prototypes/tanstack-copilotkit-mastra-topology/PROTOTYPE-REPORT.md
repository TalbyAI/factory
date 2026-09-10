# Topology Factory prototype report

## Verdict

**Refuted** on the current commit. The happy path, authorization, and
idempotency assertions pass, but the BFF exits when an SSE client disconnects.
That prevents the required reconnection guarantee from being validated.

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

`node --check src/self-check.mjs` exits 0. `npm run self-check` starts the
supervisor, checks both child health endpoints, and resets only
`topology_prototype`. PostgreSQL was already healthy under this prototype's
Compose project and was left running; the owned supervisor and children were
stopped and the scratch schemas reset.

| Scenario | Result | Observed evidence |
| --- | --- | --- |
| Happy path: stable identity and one effect | Validated | `POST /api/runs` returned 200; one Run suspended and completed with the same `runId`; `topology_factory.effects` counted `1`. Wire events were sequences 1–9. |
| Missing operator key | Validated | `POST /api/runs/:runId/commands` returned 401. |
| Duplicate approval | Validated | Repeating `approve-1` returned 200 and the effect count remained `1`. |
| Reconnect/no replay | Refuted | After 250 ms with no event after completion, the client disconnect caused BFF's proxied upstream fetch to raise `AbortError`; BFF health became unavailable and the self-check failed `BFF must survive an SSE client disconnect`. |
| Independent BFF restart and replay | Not executed | The assert-based check exits at the first failure. |
| Mastra restart, approval, and completion | Not executed | The assert-based check exits at the first failure. |

Mastra wire events name suspension `workflow-step-suspended` and successful
completion `workflow-finish` with `workflowStatus: "success"`. The self-check
maps only those two wire forms to the brief's semantic
`workflow.suspended`/`workflow.completed` names while retaining the stored
`runId` and `sequence`.

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
- The BFF disconnect failure must be fixed and the full self-check rerun before
  treating restart recovery as validated.
