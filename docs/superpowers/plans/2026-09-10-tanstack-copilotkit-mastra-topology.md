# TanStack/CopilotKit/Mastra Topology Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a throwaway, reproducible two-process spike that answers whether the selected remote topology preserves streaming, HITL, authorized commands, and reconnection across independent BFF and Mastra restarts.

**Architecture:** A small BFF process owns the Operator boundary, command authorization, Factory scratch schema, and SSE endpoint. A separate Mastra process owns a real Mastra Workflow backed by its own PostgreSQL schema and exposes start, observe, resume, and health endpoints. A supervisor serves the browser page and can restart either child process; the browser reconnects from the last event sequence.

**Tech Stack:** Node.js 24, `node:http`, `@mastra/core` 1.64.0, `@mastra/pg` 1.22.3, `pg` 8.16.3, `zod` 4.1.8, PostgreSQL 17, plain HTML/CSS/JS, Docker Compose.

## Global Constraints

- The artifact lives under `prototypes/tanstack-copilotkit-mastra-topology/` and never becomes production runtime code.
- Factory and Mastra use separate PostgreSQL schemas, `topology_factory` and `topology_mastra`.
- The browser never receives the Mastra service token; only the BFF may call the Mastra process.
- Every event carries a stable `runId` and increasing `sequence`; reconnect requests use `after`.
- Every privileged command is checked at the BFF and carries an idempotency key.
- The prototype must be runnable with `docker compose up -d postgres` followed by `npm run prototype`.
- The self-check is one assert-based executable, not a test framework or production test suite.

---

### Task 1: Scaffold the disposable topology harness

**Files:**
- Create: `prototypes/tanstack-copilotkit-mastra-topology/package.json`
- Create: `prototypes/tanstack-copilotkit-mastra-topology/compose.yaml`
- Create: `prototypes/tanstack-copilotkit-mastra-topology/src/config.mjs`
- Create: `prototypes/tanstack-copilotkit-mastra-topology/src/db.mjs`
- Create: `prototypes/tanstack-copilotkit-mastra-topology/src/protocol.mjs`

**Interfaces:**
- `config.mjs` produces `DATABASE_URL`, `BFF_PORT`, `MASTRA_PORT`, `BFF_URL`, and `SERVICE_TOKEN` from environment defaults.
- `db.mjs` exports `createPool()`, `assertScratchDatabase(pool)`, `resetSchemas(pool)`, and `closePool(pool)`.
- `protocol.mjs` exports `json(res, status, value)`, `readJson(req)`, `sseHeaders(res)`, `writeEvent(res, event)`, and `eventFromRow(row)`.

- [ ] **Step 1: Copy the already-proven pinned Mastra dependency set into the new manifest.**

```json
{
  "name": "tanstack-copilotkit-mastra-topology-prototype",
  "private": true,
  "type": "module",
  "scripts": {
    "prototype": "node src/supervisor.mjs",
    "self-check": "node src/self-check.mjs"
  },
  "dependencies": {
    "@mastra/core": "1.64.0",
    "@mastra/pg": "1.22.3",
    "pg": "8.16.3",
    "zod": "4.1.8"
  }
}
```

- [ ] **Step 2: Add a disposable PostgreSQL service with an explicit database name and port.**

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: topology_prototype
      POSTGRES_USER: prototype
      POSTGRES_PASSWORD: prototype
    ports:
      - "55433:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U prototype -d topology_prototype"]
      interval: 1s
      timeout: 3s
      retries: 30
    volumes:
      - topology-prototype:/var/lib/postgresql/data

volumes:
  topology-prototype:
```

- [ ] **Step 3: Implement the shared configuration and scratch schema reset.**

```js
// src/config.mjs
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://prototype:prototype@localhost:55433/topology_prototype',
  bffPort: Number(process.env.BFF_PORT ?? 4310),
  mastraPort: Number(process.env.MASTRA_PORT ?? 4311),
  supervisorPort: Number(process.env.SUPERVISOR_PORT ?? 4312),
  bffUrl: process.env.BFF_URL ?? 'http://127.0.0.1:4310',
  serviceToken: process.env.SERVICE_TOKEN ?? 'prototype-service-token',
};
```

```js
// src/db.mjs
import pg from 'pg';
import { config } from './config.mjs';

export function createPool() {
  return new pg.Pool({ connectionString: config.databaseUrl });
}

export async function assertScratchDatabase(pool) {
  const { rows: [row] } = await pool.query('select current_database() as name');
  if (row.name !== 'topology_prototype') throw new Error(`Refusing database ${row.name}`);
}

export async function resetSchemas(pool) {
  await assertScratchDatabase(pool);
  await pool.query('drop schema if exists topology_mastra cascade; drop schema if exists topology_factory cascade');
  await pool.query(`
    create schema topology_factory;
    create schema topology_mastra;
    create table topology_factory.missions (
      run_id text primary key,
      mission_id text not null,
      status text not null,
      gate text not null,
      created_at timestamptz not null default now()
    );
    create table topology_factory.commands (
      idempotency_key text primary key,
      run_id text not null,
      command text not null,
      accepted boolean not null,
      created_at timestamptz not null default now()
    );
    create table topology_factory.effects (
      idempotency_key text primary key,
      run_id text not null,
      created_at timestamptz not null default now()
    );
    create table topology_mastra.events (
      run_id text not null,
      sequence integer not null,
      kind text not null,
      payload jsonb not null,
      primary key (run_id, sequence)
    );
  `);
}

export async function closePool(pool) {
  await pool?.end();
}
```

- [ ] **Step 4: Implement JSON and SSE helpers with no framework dependency.**

```js
// src/protocol.mjs
export function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

export async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function sseHeaders(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
}

export function writeEvent(res, event) {
  res.write(`id: ${event.sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
}

export function eventFromRow(row) {
  return { runId: row.run_id, sequence: row.sequence, kind: row.kind, ...row.payload };
}
```

- [ ] **Step 5: Install dependencies and verify the empty harness starts from a disposable database.**

Run: `npm install` in `prototypes/tanstack-copilotkit-mastra-topology`, then `docker compose up -d postgres` and `node -e "import('./src/db.mjs').then(async ({createPool,resetSchemas,closePool}) => { const pool=createPool(); await resetSchemas(pool); await closePool(pool); })"`.

Expected: npm creates a lockfile, PostgreSQL becomes healthy, and the command exits 0 without touching any database other than `topology_prototype`.

- [ ] **Step 6: Commit the scaffold.**

```text
git add prototypes/tanstack-copilotkit-mastra-topology
git commit -m "prototype: scaffold topology harness"
```

### Task 2: Implement the Mastra process and durable event stream

**Files:**
- Create: `prototypes/tanstack-copilotkit-mastra-topology/src/mastra-server.mjs`
- Modify: `prototypes/tanstack-copilotkit-mastra-topology/src/db.mjs`
- Create: `prototypes/tanstack-copilotkit-mastra-topology/src/mastra-workflow.mjs`

**Interfaces:**
- `mastra-workflow.mjs` exports `makeWorkflow(pool)` with step id `operator-gate` and an output schema containing `runId`, `approved`, and `effectKey`.
- `mastra-server.mjs` serves `GET /health`, `POST /runs`, `POST /runs/:runId/resume`, and `GET /runs/:runId/events?after={sequence}`.
- `POST /runs` returns `{ runId, workflowId }` immediately and starts the Workflow in the background.
- `POST /runs/:runId/resume` accepts `{ command: "approve", idempotencyKey }` and returns `{ runId, accepted: true }`.
- `GET /runs/:runId/events` emits stored events first, then live events until the run reaches `completed` or `suspended`.

- [ ] **Step 1: Add Mastra-owned event persistence and a single-run pub/sub registry to `db.mjs`.**

Add these functions without changing the existing schema contract:

```js
export async function appendEvent(pool, runId, kind, payload) {
  const { rows: [row] } = await pool.query(
    `insert into topology_mastra.events (run_id, sequence, kind, payload)
     values ($1, coalesce((select max(sequence) + 1 from topology_mastra.events where run_id = $1), 1), $2, $3)
     returning run_id, sequence, kind, payload`,
    [runId, kind, payload],
  );
  return eventFromRow(row);
}

export async function eventsAfter(pool, runId, after) {
  const { rows } = await pool.query(
    `select run_id, sequence, kind, payload from topology_mastra.events
     where run_id = $1 and sequence > $2 order by sequence`,
    [runId, after],
  );
  return rows.map(eventFromRow);
}
```

- [ ] **Step 2: Define the suspended Workflow and its idempotent effect callback.**

Use the existing pinned Mastra pattern from `prototypes/mastra-postgres-recovery/src/harness.mjs`: `createStep`, `createWorkflow`, `PostgresStore`, and a stable `runId`. The first invocation emits `gate.pending` and calls `suspend({ gate: 'operator-approval' })`; the resumed invocation calls `POST ${config.bffUrl}/internal/effects` with `Authorization: Bearer ${config.serviceToken}` and `Idempotency-Key: ${runId}:publish`, then returns the output. Do not call external providers.

- [ ] **Step 3: Build the Mastra server around `Mastra` and the Workflow run API.**

Implement these handlers:

```js
const subscribers = new Map();

async function publishChunk(runId, chunk) {
  const event = await appendEvent(pool, runId, chunk.type, { chunk });
  for (const subscriber of subscribers.get(runId) ?? []) writeEvent(subscriber, event);
  return event;
}

async function startRun(runId) {
  const workflow = mastra.getWorkflow('topology-workflow');
  const run = await workflow.createRun({ runId });
  const output = run.stream({ inputData: { runId }, closeOnSuspend: true });
  activeRuns.set(runId, output);
  void (async () => {
    for await (const chunk of output.fullStream) await publishChunk(runId, chunk);
    await output.result;
  })().catch(error => publishChunk(runId, { type: 'workflow.error', error: error.message }));
}

async function resumeRun(runId, resumeData) {
  const workflow = mastra.getWorkflow('topology-workflow');
  const run = await workflow.createRun({ runId });
  const output = run.resumeStream({ step: 'operator-gate', resumeData });
  activeRuns.set(runId, output);
  void (async () => {
    for await (const chunk of output.fullStream) await publishChunk(runId, chunk);
    await output.result;
  })().catch(error => publishChunk(runId, { type: 'workflow.error', error: error.message }));
}

async function streamEvents(res, runId, after) {
  sseHeaders(res);
  for (const event of await eventsAfter(pool, runId, after)) writeEvent(res, event);
  const list = subscribers.get(runId) ?? new Set();
  list.add(res);
  subscribers.set(runId, list);
  res.on('close', () => list.delete(res));
}
```

The implementation must call `startRun` without awaiting it in the HTTP handler, preserve the same `runId` on resume, and close an SSE client only after a terminal event or a client disconnect. On a process restart, the server must rebuild its Mastra instance from PostgreSQL before accepting requests.

- [ ] **Step 4: Run a direct Mastra-process smoke check.**

Run: `node src/mastra-server.mjs` in one terminal and `Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4311/runs -ContentType 'application/json' -Body '{"runId":"smoke-run"}'` in another.

Expected: the POST returns a stable `runId`; `curl -N 'http://127.0.0.1:4311/runs/smoke-run/events?after=0'` shows `gate.pending`; restarting the process and reconnecting shows the same stored event.

- [ ] **Step 5: Commit the Mastra process.**

```text
git add prototypes/tanstack-copilotkit-mastra-topology/src
git commit -m "prototype: add durable Mastra topology process"
```

### Task 3: Implement the BFF boundary, supervisor, and operator page

**Files:**
- Create: `prototypes/tanstack-copilotkit-mastra-topology/src/bff.mjs`
- Create: `prototypes/tanstack-copilotkit-mastra-topology/src/supervisor.mjs`
- Create: `prototypes/tanstack-copilotkit-mastra-topology/public/index.html`

**Interfaces:**
- BFF serves `GET /health`, `POST /api/runs`, `GET /api/runs/:runId/events?after={sequence}`, `POST /api/runs/:runId/commands`, `POST /internal/effects`, and `GET /`.
- Browser commands use `x-operator-key: prototype-operator-key`; Mastra calls use `Authorization: Bearer prototype-service-token`.
- Supervisor starts the BFF and Mastra children, serves only its local control API on port 4312, and handles `POST /admin/restart/bff` and `POST /admin/restart/mastra` by terminating and respawning only the requested child. The BFF serves the static page on port 4310.

- [ ] **Step 1: Implement BFF authentication and run creation.**

`POST /api/runs` must reject missing `x-operator-key` with 401, create a UUID `runId`, insert one `topology_factory.missions` row with status `running` and gate `pending`, then call Mastra `POST /runs` with the service token. It returns `{ runId }` only after both the Factory row and Mastra start request succeed.

- [ ] **Step 2: Implement the reconnection SSE endpoint.**

Read `after` from the query string, call Mastra `GET /runs/:runId/events?after={after}` with the service token, and proxy the SSE stream without exposing the service token. If the upstream connection closes, return a normal disconnect; the browser will reconnect using its last event id. The BFF must not create a second Run during reconnect.

- [ ] **Step 3: Implement one authorized command path and one denied path.**

For `POST /api/runs/:runId/commands`, require the operator key, require `{ command: 'approve', idempotencyKey }`, and verify the current Factory gate is `pending`. Insert the command with `on conflict (idempotency_key) do nothing`; reject a different command or stale gate with 409. Forward the first accepted command to Mastra `/runs/:runId/resume`, then mark the gate `satisfied`.

For `POST /internal/effects`, require the service token and insert the idempotency key into `topology_factory.effects` with `on conflict do nothing`; return `{ effective: true }` only for the first insert and `{ effective: false }` for replays.

- [ ] **Step 4: Add the supervisor and browser page.**

The page must contain buttons labelled `Iniciar Run`, `Aprobar Gate`, `Reconectar`, `Reiniciar BFF`, and `Reiniciar Mastra`; render `runId`, gate state, last sequence, each received event, and the result of the most recent command. `EventSource` must set the stream URL with `after` equal to the last applied sequence after every event. The page must never contain the service token.

- [ ] **Step 5: Manually exercise the visible scenarios.**

Run: `npm run prototype` after `docker compose up -d postgres`, open `http://127.0.0.1:4310`, start a Run, approve the Gate, click `Reconectar`, then call `POST http://127.0.0.1:4312/admin/restart/bff` and `POST http://127.0.0.1:4312/admin/restart/mastra` separately.

Expected: the page shows one `runId`, no sequence regression, the Gate remains meaningful across restart, an authorized approval resumes the Run, and a duplicate approval key creates no second effect.

- [ ] **Step 6: Commit the BFF and operator page.**

```text
git add prototypes/tanstack-copilotkit-mastra-topology
git commit -m "prototype: add topology BFF and restart controls"
```

### Task 4: Add the assert-based self-check, README, and report

**Files:**
- Create: `prototypes/tanstack-copilotkit-mastra-topology/src/self-check.mjs`
- Create: `prototypes/tanstack-copilotkit-mastra-topology/README.md`
- Create: `prototypes/tanstack-copilotkit-mastra-topology/PROTOTYPE-REPORT.md`

**Interfaces:**
- `self-check.mjs` starts the supervisor in-process or as a child, drives the HTTP endpoints with `fetch`, and exits nonzero on the first failed assertion.
- `PROTOTYPE-REPORT.md` records the exact versions, commands, scenarios, observed evidence, limits, and verdict `validated`, `refuted`, or `inconclusive`.

- [ ] **Step 1: Drive the happy path and assert the stable identity.**

Use this shape for the first assertion block:

```js
const start = await request('/api/runs', { method: 'POST', headers: operatorHeaders });
assert.equal(start.status, 200);
const { runId } = await start.json();
const pending = await nextEvents(runId, 0, event => event.kind === 'workflow.suspended');
assert.equal(pending.runId, runId);

const approval = await request(`/api/runs/${runId}/commands`, {
  method: 'POST',
  headers: { ...operatorHeaders, 'content-type': 'application/json' },
  body: JSON.stringify({ command: 'approve', idempotencyKey: 'approve-1' }),
});
assert.equal(approval.status, 200);
const completed = await nextEvents(runId, pending.sequence, event => event.kind === 'workflow.completed');
assert.equal(completed.runId, runId);
assert.equal((await scalar('select count(*) from topology_factory.effects')).value, '1');
```

The helper `nextEvents` must keep the last sequence in its local cursor, and the helper `scalar` must query only the scratch database.

- [ ] **Step 2: Drive authorization, duplicate, and reconnection assertions.**

Use these exact assertions after the happy path:

```js
const denied = await request(`/api/runs/${runId}/commands`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ command: 'approve', idempotencyKey: 'denied-1' }),
});
assert.equal(denied.status, 401);

const duplicate = await request(`/api/runs/${runId}/commands`, {
  method: 'POST',
  headers: { ...operatorHeaders, 'content-type': 'application/json' },
  body: JSON.stringify({ command: 'approve', idempotencyKey: 'approve-1' }),
});
assert.equal(duplicate.status, 200);
assert.equal((await scalar('select count(*) from topology_factory.effects')).value, '1');

const replay = await nextEvents(runId, completed.sequence, () => true, 250);
assert.equal(replay, undefined);
```

- [ ] **Step 3: Drive independent restart assertions.**

Start a second Run, wait for `workflow.suspended`, call `POST /admin/restart/bff`, reconnect from sequence `0`, and assert that the original `runId` and `workflow.suspended` event remain present. Start a third Run, wait for suspension, call `POST /admin/restart/mastra`, approve it with a new key, and assert that a `workflow.completed` event arrives with the original `runId`. A failed assertion is a refuted result, not a reason to loosen the check.

- [ ] **Step 4: Write the reproducible README and report from observed output.**

The README must contain the one-command startup, stop/reset commands, browser URL, and the scratch database safety warning. The report must include a scenario table, exact Node/PostgreSQL/package versions, the no-token-in-browser observation, and the explicit limits from the design document.

- [ ] **Step 5: Run the final verification.**

Run: `npm run self-check` and `git diff --check`.

Expected: the self-check exits 0; the report agrees with observed output; `git diff --check` is silent.

- [ ] **Step 6: Commit the captured prototype.**

```text
git add prototypes/tanstack-copilotkit-mastra-topology
git commit -m "prototype: validate two-process topology recovery"
```

### Task 5: Publish the resolution for the Wayfinder ticket

**Files:**
- Modify: GitHub issue `Probar la topología TanStack Start, CopilotKit y Mastra`
- Modify: GitHub issue `Definir funcional y técnicamente la Factory local-first`

- [ ] **Step 1: Verify the branch delta before publishing.**

Run: `git status --short` and `git diff origin/main...HEAD`.

Expected: only the design/plan documents and prototype directory are present; no unrelated files or `main` changes exist.

- [ ] **Step 2: Push the prototype branch and open a pull request.**

Use the repository's GitHub issue workflow. The pull request body must contain `Closes #14`, link the report, and state that the artifact is throwaway and preserved as primary evidence.

- [ ] **Step 3: Comment the resolution without closing the issue directly.**

Post `## Resolución` with the verdict, the evidence/report link, the prototype branch, and any conditional safeguards. Keep the issue open until the pull request is reviewed and merged.

- [ ] **Step 4: Append one gist to the map's `Decisions so far`.**

Add a single linked line for `Probar la topología TanStack Start, CopilotKit y Mastra`; do not copy the full report into the map. The child issue remains the sole source of decision detail.
