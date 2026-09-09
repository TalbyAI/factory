import { execFile as execFileCallback, spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Mastra } from '@mastra/core/mastra';
import { MastraNonRetryableError } from '@mastra/core/error';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { PostgresStore } from '@mastra/pg';
import pg from 'pg';
import { z } from 'zod';

const execFile = promisify(execFileCallback);
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://prototype:prototype@localhost:55432/factory_prototype';
const MASTRA_SCHEMA = 'prototype_mastra';
const FACTORY_SCHEMA = 'prototype_factory';
const FACTORY = `"${FACTORY_SCHEMA}"`;
const MASTRA = `"${MASTRA_SCHEMA}"`;
const VERSION_A = '1.0.0+a';
const VERSION_B = '2.0.0+b';
const RESULT_PREFIX = '@@RESULT@@';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function makePool() {
  return new pg.Pool({ connectionString: DATABASE_URL });
}

async function assertScratchDatabase(pool) {
  const { rows: [row] } = await pool.query('SELECT current_database() AS name');
  if (row.name !== 'factory_prototype') throw new Error(`Refusing to alter non-prototype database ${row.name}`);
}

async function resetScratchDatabase(pool) {
  await assertScratchDatabase(pool);
  await pool.query(`DROP SCHEMA IF EXISTS ${MASTRA} CASCADE; DROP SCHEMA IF EXISTS ${FACTORY} CASCADE`);
  await pool.query(`
    CREATE SCHEMA ${FACTORY};
    CREATE TABLE ${FACTORY}.runs (
      run_id text PRIMARY KEY,
      mission_id text NOT NULL,
      workflow_id text NOT NULL,
      workflow_version text NOT NULL
    );
    CREATE TABLE ${FACTORY}.mission_gates (
      run_id text PRIMARY KEY REFERENCES ${FACTORY}.runs(run_id),
      child_state text NOT NULL
    );
    CREATE TABLE ${FACTORY}.effects (
      effect_key text PRIMARY KEY,
      run_id text NOT NULL
    );
    CREATE TABLE ${FACTORY}.executions (
      execution_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      run_id text NOT NULL,
      step_id text NOT NULL,
      retry_count integer NOT NULL
    );
    CREATE TABLE ${FACTORY}.markers (
      run_id text NOT NULL,
      marker text NOT NULL,
      PRIMARY KEY (run_id, marker)
    )
  `);
}

async function recordExecution(pool, runId, stepId, retryCount = 0) {
  await pool.query(
    `INSERT INTO ${FACTORY}.executions (run_id, step_id, retry_count) VALUES ($1, $2, $3)`,
    [runId, stepId, retryCount],
  );
  const { rows: [row] } = await pool.query(
    `SELECT count(*)::integer AS count FROM ${FACTORY}.executions WHERE run_id = $1 AND step_id = $2`,
    [runId, stepId],
  );
  return row.count;
}

async function createEffect(pool, runId, key) {
  const { rowCount } = await pool.query(
    `INSERT INTO ${FACTORY}.effects (effect_key, run_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [key, runId],
  );
  return rowCount === 1;
}

async function mark(pool, runId, marker) {
  await pool.query(
    `INSERT INTO ${FACTORY}.markers (run_id, marker) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [runId, marker],
  );
}

function makeWorkflow(kind, factoryPool) {
  const input = z.object({ missionId: z.string() });

  if (kind === 'suspend' || kind === 'resume-race' || kind === 'version') {
    const output = z.object({ missionId: z.string(), resumed: z.boolean() });
    const step = createStep({
      id: 'wait-for-child',
      inputSchema: input,
      outputSchema: output,
      resumeSchema: z.object({ childState: z.literal('Completed') }),
      suspendSchema: z.object({ gate: z.literal('mission-gate'), childMissionId: z.string() }),
      execute: async ({ inputData, resumeData, runId, suspend }) => {
        if (!resumeData) {
          return suspend({ gate: 'mission-gate', childMissionId: `${inputData.missionId}-child` });
        }
        if (kind === 'resume-race') {
          await recordExecution(factoryPool, runId, 'after-resume');
          await createEffect(factoryPool, runId, `${runId}:resume`);
          await sleep(750);
        }
        return { missionId: inputData.missionId, resumed: true };
      },
    });
    return createWorkflow({ id: `${kind}-workflow`, inputSchema: input, outputSchema: output }).then(step).commit();
  }

  if (kind === 'effect-crash' || kind === 'restart-race') {
    const output = z.object({ missionId: z.string(), effectCreated: z.boolean() });
    const step = createStep({
      id: 'external-effect',
      inputSchema: input,
      outputSchema: output,
      execute: async ({ inputData, runId, retryCount }) => {
        await recordExecution(factoryPool, runId, 'external-effect', retryCount);
        const effectCreated = await createEffect(factoryPool, runId, `${runId}:effect`);
        await mark(factoryPool, runId, 'effect-committed');
        if (process.env.WORKER_PHASE === 'crash' && effectCreated) process.kill(process.pid, 'SIGKILL');
        if (kind === 'restart-race') await sleep(1500);
        return { missionId: inputData.missionId, effectCreated };
      },
    });
    return createWorkflow({ id: `${kind}-workflow`, inputSchema: input, outputSchema: output }).then(step).commit();
  }

  if (kind === 'retry') {
    const output = z.object({ missionId: z.string(), attempts: z.number() });
    const step = createStep({
      id: 'flaky-step',
      inputSchema: input,
      outputSchema: output,
      retries: 2,
      execute: async ({ inputData, runId, retryCount }) => {
        const attempts = await recordExecution(factoryPool, runId, 'flaky-step', retryCount);
        if (attempts < 3) throw new Error(`transient failure ${attempts}`);
        if (attempts === 3 && process.env.WORKER_PHASE === 'crash') process.kill(process.pid, 'SIGKILL');
        if (attempts > 3) throw new MastraNonRetryableError('Factory durable attempt budget exhausted');
        return { missionId: inputData.missionId, attempts };
      },
    });
    return createWorkflow({ id: 'retry-workflow', inputSchema: input, outputSchema: output }).then(step).commit();
  }

  if (kind === 'shutdown') {
    const output = z.object({ missionId: z.string(), recovered: z.boolean() });
    const step = createStep({
      id: 'long-step',
      inputSchema: input,
      outputSchema: output,
      execute: async ({ inputData, runId }) => {
        await recordExecution(factoryPool, runId, 'long-step');
        if (process.env.WORKER_PHASE === 'running') {
          await mark(factoryPool, runId, 'ready-for-sigterm');
          await new Promise(() => {});
        }
        return { missionId: inputData.missionId, recovered: true };
      },
    });
    return createWorkflow({ id: 'shutdown-workflow', inputSchema: input, outputSchema: output }).then(step).commit();
  }

  throw new Error(`Unknown workflow kind ${kind}`);
}

function makeSizeWorkflow(stepCount) {
  const shape = z.object({ missionId: z.string(), refs: z.array(z.string()) });
  let workflow = createWorkflow({ id: `size-${stepCount}-workflow`, inputSchema: shape, outputSchema: shape });
  for (let index = 1; index <= stepCount; index += 1) {
    workflow = workflow.then(createStep({
      id: `reference-${index}`,
      inputSchema: shape,
      outputSchema: shape,
      execute: async ({ inputData }) => ({
        ...inputData,
        refs: [...inputData.refs, `sha256:${String(index).padStart(64, '0')}`],
      }),
    }));
  }
  return workflow.commit();
}

function makeMastra(workflows) {
  const storage = new PostgresStore({
    id: `mastra-recovery-prototype-${process.pid}`,
    connectionString: DATABASE_URL,
    schemaName: MASTRA_SCHEMA,
  });
  const keyed = Object.fromEntries(workflows.map(workflow => [workflow.id, workflow]));
  const mastra = new Mastra({ storage, workflows: keyed });
  return { mastra, storage };
}

function emitResult(value) {
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(value)}\n`);
}

async function closeResources(factoryPool, storage) {
  await Promise.allSettled([factoryPool?.end(), storage?.close()]);
}

async function workerMain([command, kind, runId, version = VERSION_A]) {
  const factoryPool = makePool();
  let storage;
  try {
    if (command === 'size') {
      const workflows = [1, 10, 50].map(makeSizeWorkflow);
      const resources = makeMastra(workflows);
      storage = resources.storage;
      const sizes = [];
      for (const workflow of workflows) {
        const registered = resources.mastra.getWorkflow(workflow.id);
        const sizeRunId = `${workflow.id}-run`;
        const started = performance.now();
        const result = await (await registered.createRun({ runId: sizeRunId })).start({
          inputData: { missionId: sizeRunId, refs: [] },
        });
        const { rows: [row] } = await factoryPool.query(
          `SELECT pg_column_size(snapshot)::integer AS bytes FROM ${MASTRA}.mastra_workflow_snapshot WHERE run_id = $1`,
          [sizeRunId],
        );
        sizes.push({ steps: Number(workflow.id.split('-')[1]), status: result.status, bytes: row.bytes, elapsedMs: Math.round(performance.now() - started) });
      }
      emitResult({ outcome: 'measured', sizes });
      return;
    }

    const workflow = makeWorkflow(kind, factoryPool);
    const resources = makeMastra([workflow]);
    storage = resources.storage;
    const registered = resources.mastra.getWorkflow(workflow.id);

    if (kind === 'shutdown' && process.env.WORKER_PHASE === 'running') {
      process.once('SIGTERM', async () => {
        await mark(factoryPool, runId, 'sigterm-handled');
        await Promise.race([closeResources(factoryPool, storage), sleep(2000)]);
        process.exit(143);
      });
    }

    if (command === 'start') {
      await factoryPool.query(
        `INSERT INTO ${FACTORY}.runs (run_id, mission_id, workflow_id, workflow_version) VALUES ($1, $2, $3, $4)`,
        [runId, `${runId}-mission`, workflow.id, version],
      );
      if (['suspend', 'resume-race', 'version'].includes(kind)) {
        await factoryPool.query(`INSERT INTO ${FACTORY}.mission_gates (run_id, child_state) VALUES ($1, 'Open')`, [runId]);
      }
      const run = await registered.createRun({ runId });
      const result = await run.start({ inputData: { missionId: `${runId}-mission` } });
      emitResult({ outcome: result.status, runId: run.runId });
      return;
    }

    if (command === 'inspect') {
      const state = await registered.getWorkflowRunById(runId);
      const active = await registered.listActiveWorkflowRuns();
      emitResult({ outcome: 'inspected', status: state?.status, activeRunIds: active.runs.map(run => run.runId) });
      return;
    }

    if (command === 'resume') {
      const { rows: [factoryRun] } = await factoryPool.query(`SELECT workflow_version FROM ${FACTORY}.runs WHERE run_id = $1`, [runId]);
      const { rows: [gate] } = await factoryPool.query(`SELECT child_state FROM ${FACTORY}.mission_gates WHERE run_id = $1`, [runId]);
      if (factoryRun.workflow_version !== version) {
        emitResult({ outcome: 'version-mismatch', stored: factoryRun.workflow_version, worker: version });
        return;
      }
      if (gate.child_state !== 'Completed') {
        emitResult({ outcome: 'gate-not-satisfied', childState: gate.child_state });
        return;
      }
      const result = await (await registered.createRun({ runId })).resume({
        step: 'wait-for-child',
        resumeData: { childState: 'Completed' },
      });
      emitResult({ outcome: result.status, runId });
      return;
    }

    if (command === 'restart') {
      const result = await (await registered.createRun({ runId })).restart();
      emitResult({ outcome: result.status, runId, error: result.status === 'failed' ? result.error?.message : undefined });
      return;
    }

    if (command === 'restart-locked') {
      const client = await factoryPool.connect();
      try {
        const { rows: [lock] } = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired', [runId]);
        if (!lock.acquired) {
          emitResult({ outcome: 'lock-not-acquired', runId });
          return;
        }
        // ponytail: one per-Run PostgreSQL lock is enough for local-first; add leases/leader election for multi-replica deployment.
        const result = await (await registered.createRun({ runId })).restart();
        emitResult({ outcome: result.status, runId });
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [runId]);
      } finally {
        client.release();
      }
      return;
    }

    throw new Error(`Unknown worker command ${command}`);
  } catch (error) {
    emitResult({ outcome: 'error', name: error.name, message: error.message, code: error.id ?? error.code });
    process.exitCode = 2;
  } finally {
    await closeResources(factoryPool, storage);
  }
}

function startWorker(args, phase) {
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname, '--worker', ...args], {
    env: { ...process.env, WORKER_PHASE: phase ?? '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise(resolve => child.on('close', (code, signal) => {
    const line = stdout.split(/\r?\n/).findLast(value => value.startsWith(RESULT_PREFIX));
    resolve({ code, signal, result: line ? JSON.parse(line.slice(RESULT_PREFIX.length)) : undefined, stderr: stderr.trim() });
  }));
  return { child, done };
}

async function runWorker(args, phase) {
  return startWorker(args, phase).done;
}

function requireCheck(condition, message) {
  if (!condition) throw new Error(message);
}

async function completeChild(pool, runId) {
  await pool.query(`UPDATE ${FACTORY}.mission_gates SET child_state = 'Completed' WHERE run_id = $1`, [runId]);
}

async function counts(pool, runId, stepId) {
  const { rows: [row] } = await pool.query(`
    SELECT
      (SELECT count(*)::integer FROM ${FACTORY}.executions WHERE run_id = $1 AND step_id = $2) AS executions,
      (SELECT count(*)::integer FROM ${FACTORY}.effects WHERE run_id = $1) AS effects
  `, [runId, stepId]);
  return row;
}

async function waitForMarker(pool, runId, marker, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rowCount } = await pool.query(`SELECT 1 FROM ${FACTORY}.markers WHERE run_id = $1 AND marker = $2`, [runId, marker]);
    if (rowCount === 1) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${marker}`);
}

async function scenario(name, operation) {
  try {
    return { name, outcome: 'validated', evidence: await operation() };
  } catch (error) {
    return { name, outcome: 'refuted', evidence: { error: error.message } };
  }
}

async function backupAndRestore(pool) {
  const { rows: [before] } = await pool.query(`
    SELECT
      (SELECT count(*)::integer FROM ${MASTRA}.mastra_workflow_snapshot) AS snapshots,
      (SELECT count(*)::integer FROM ${FACTORY}.runs) AS runs,
      (SELECT count(*)::integer FROM ${FACTORY}.effects) AS effects
  `);
  const directory = await mkdtemp(join(tmpdir(), 'mastra-recovery-'));
  const dump = join(directory, 'prototype.dump');
  await execFile('pg_dump', ['--format=custom', `--file=${dump}`, `--schema=${MASTRA_SCHEMA}`, `--schema=${FACTORY_SCHEMA}`, DATABASE_URL]);
  await pool.query(`DROP SCHEMA ${MASTRA} CASCADE; DROP SCHEMA ${FACTORY} CASCADE`);
  const started = performance.now();
  await execFile('pg_restore', [`--dbname=${DATABASE_URL}`, dump]);
  const restoreMs = Math.round(performance.now() - started);
  const { rows: [after] } = await pool.query(`
    SELECT
      (SELECT count(*)::integer FROM ${MASTRA}.mastra_workflow_snapshot) AS snapshots,
      (SELECT count(*)::integer FROM ${FACTORY}.runs) AS runs,
      (SELECT count(*)::integer FROM ${FACTORY}.effects) AS effects
  `);
  requireCheck(JSON.stringify(before) === JSON.stringify(after), 'PostgreSQL restore changed row counts');
  return { before, after, restoreMs };
}

async function orchestratorMain() {
  const pool = makePool();
  await resetScratchDatabase(pool);
  const results = [];

  results.push(await scenario('HITL suspension and child Mission resume', async () => {
    const runId = 'child-resume-run';
    const started = await runWorker(['start', 'suspend', runId, VERSION_A]);
    const inspected = await runWorker(['inspect', 'suspend', runId, VERSION_A]);
    requireCheck(started.result?.outcome === 'suspended', 'Run did not suspend');
    requireCheck(inspected.result?.status === 'suspended', 'Fresh process could not load suspended Run by ID');
    await completeChild(pool, runId);
    const resumed = await runWorker(['resume', 'suspend', runId, VERSION_A]);
    requireCheck(resumed.result?.outcome === 'success', 'Run did not resume after child completion');
    return { runId, before: inspected.result.status, after: resumed.result.outcome, polling: false, listedAsActive: inspected.result.activeRunIds.includes(runId) };
  }));

  results.push(await scenario('SIGKILL after external effect and restart', async () => {
    const runId = 'effect-crash-run';
    const crashed = await runWorker(['start', 'effect-crash', runId, VERSION_A], 'crash');
    requireCheck(crashed.signal === 'SIGKILL', `Expected SIGKILL, got ${crashed.signal ?? crashed.code}`);
    const restarted = await runWorker(['restart', 'effect-crash', runId, VERSION_A], 'recovery');
    const observed = await counts(pool, runId, 'external-effect');
    requireCheck(restarted.result?.outcome === 'success', 'Restart did not succeed');
    requireCheck(observed.executions === 2 && observed.effects === 1, 'Replay duplicated or lost the effective action');
    return { runId, signal: crashed.signal, ...observed, semantics: 'step replayed; effective action exactly once' };
  }));

  results.push(await scenario('Retry budget across process crash', async () => {
    const runId = 'retry-crash-run';
    const crashed = await runWorker(['start', 'retry', runId, VERSION_A], 'crash');
    requireCheck(crashed.signal === 'SIGKILL', 'Process did not die on the final local attempt');
    const restarted = await runWorker(['restart', 'retry', runId, VERSION_A], 'recovery');
    const observed = await counts(pool, runId, 'flaky-step');
    const { rows: attemptRows } = await pool.query(
      `SELECT retry_count FROM ${FACTORY}.executions WHERE run_id = $1 AND step_id = 'flaky-step' ORDER BY execution_id`,
      [runId],
    );
    const retryCounts = attemptRows.map(row => row.retry_count);
    requireCheck(observed.executions === 4, `Expected a reset local budget and guarded fourth attempt, got ${observed.executions}`);
    requireCheck(JSON.stringify(retryCounts) === '[0,1,2,0]', `Unexpected retry sequence ${retryCounts.join(',')}`);
    requireCheck(restarted.result?.outcome === 'failed', 'Factory durable budget did not stop the reset Mastra retry budget');
    return { runId, mastraLocalBudgetReset: true, retryCounts, durableExecutions: observed.executions, factoryGuard: restarted.result.error };
  }));

  results.push(await scenario('Workflow version guard', async () => {
    const runId = 'version-guard-run';
    await runWorker(['start', 'version', runId, VERSION_A]);
    await completeChild(pool, runId);
    const wrongWorker = await runWorker(['resume', 'version', runId, VERSION_B]);
    const stillSuspended = await runWorker(['inspect', 'version', runId, VERSION_A]);
    const rightWorker = await runWorker(['resume', 'version', runId, VERSION_A]);
    requireCheck(wrongWorker.result?.outcome === 'version-mismatch', 'Incompatible worker was not rejected');
    requireCheck(stillSuspended.result?.status === 'suspended', 'Rejected worker changed the Run');
    requireCheck(rightWorker.result?.outcome === 'success', 'Pinned worker could not resume the Run');
    return { runId, rejected: wrongWorker.result, compatibleWorker: rightWorker.result.outcome };
  }));

  results.push(await scenario('Concurrent resume and restart claims', async () => {
    const resumeRunId = 'resume-race-run';
    await runWorker(['start', 'resume-race', resumeRunId, VERSION_A]);
    await completeChild(pool, resumeRunId);
    const resumes = await Promise.all([
      runWorker(['resume', 'resume-race', resumeRunId, VERSION_A]),
      runWorker(['resume', 'resume-race', resumeRunId, VERSION_A]),
    ]);
    const resumeCounts = await counts(pool, resumeRunId, 'after-resume');
    requireCheck(resumes.filter(item => item.result?.outcome === 'success').length === 1, 'Concurrent resume did not produce exactly one winner');
    requireCheck(resumeCounts.executions === 1 && resumeCounts.effects === 1, 'Concurrent resume duplicated work');

    const restartRunId = 'restart-race-run';
    await runWorker(['start', 'restart-race', restartRunId, VERSION_A], 'crash');
    const restarts = await Promise.all([
      runWorker(['restart-locked', 'restart-race', restartRunId, VERSION_A], 'recovery'),
      runWorker(['restart-locked', 'restart-race', restartRunId, VERSION_A], 'recovery'),
    ]);
    const restartCounts = await counts(pool, restartRunId, 'external-effect');
    requireCheck(restarts.filter(item => item.result?.outcome === 'success').length === 1, 'Restart lock did not produce exactly one winner');
    requireCheck(restarts.filter(item => item.result?.outcome === 'lock-not-acquired').length === 1, 'Restart loser was not excluded');
    requireCheck(restartCounts.effects === 1, 'Concurrent restart duplicated the effective action');
    return {
      resume: { results: resumes.map(item => item.result), ...resumeCounts },
      restart: { results: restarts.map(item => item.result), ...restartCounts },
    };
  }));

  results.push(await scenario('SIGTERM shutdown and recovery', async () => {
    const runId = 'sigterm-run';
    const running = startWorker(['start', 'shutdown', runId, VERSION_A], 'running');
    await waitForMarker(pool, runId, 'ready-for-sigterm');
    running.child.kill('SIGTERM');
    const stopped = await running.done;
    await waitForMarker(pool, runId, 'sigterm-handled');
    requireCheck(stopped.code === 143 || stopped.signal === 'SIGTERM', `Expected handled SIGTERM, got ${stopped.signal ?? stopped.code}`);
    const restarted = await runWorker(['restart', 'shutdown', runId, VERSION_A], 'recovery');
    const observed = await counts(pool, runId, 'long-step');
    requireCheck(restarted.result?.outcome === 'success' && observed.executions === 2, 'SIGTERM Run did not restart from its durable snapshot');
    return { runId, stop: stopped.signal ?? stopped.code, handled: true, after: restarted.result.outcome, executions: observed.executions };
  }));

  results.push(await scenario('Snapshot growth and joint backup/restore', async () => {
    const measured = await runWorker(['size']);
    requireCheck(measured.result?.outcome === 'measured', 'Snapshot measurements failed');
    requireCheck(measured.result.sizes.every(item => item.status === 'success'), 'A size workflow failed');
    const restored = await backupAndRestore(pool);
    return { snapshots: measured.result.sizes, backupRestore: restored };
  }));

  await pool.end();
  const report = {
    question: 'Can pinned Mastra Workflows plus minimal Factory guards survive suspension, crashes, resume, retries and child Missions without duplicating effective actions?',
    versions: { node: process.version, postgres: '17', '@mastra/core': '1.64.0', '@mastra/pg': '1.22.3' },
    generatedAt: new Date().toISOString(),
    results,
    proposedVerdict: results.every(result => result.outcome === 'validated') ? 'validated' : 'refuted',
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.proposedVerdict !== 'validated') process.exitCode = 1;
}

if (process.argv[2] === '--worker') await workerMain(process.argv.slice(3));
else await orchestratorMain();
