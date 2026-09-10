import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { config } from './config.mjs';
import { assertScratchDatabase, closePool, createPool, resetSchemas } from './db.mjs';

const bffUrl = `http://127.0.0.1:${config.bffPort}`;
const mastraUrl = `http://127.0.0.1:${config.mastraPort}`;
const supervisorUrl = `http://127.0.0.1:${config.supervisorPort}`;
const operatorHeaders = { 'x-operator-key': 'prototype-operator-key' };

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

async function waitForExit(child) {
  const controller = new AbortController();
  try {
    const result = await Promise.race([
      new Promise(resolve => child.once('exit', () => resolve('exit'))),
      delay(5_000, 'timeout', { signal: controller.signal }),
    ]);
    if (result === 'timeout') throw new Error('Timed out stopping supervisor');
  } finally {
    controller.abort();
  }
}

async function stopSupervisor(supervisor) {
  if (supervisor?.exitCode !== null) return;
  const exited = waitForExit(supervisor);
  supervisor.kill('SIGINT');
  try {
    await exited;
  } catch (error) {
    if (supervisor.exitCode !== null) throw error;
    const forcedExit = waitForExit(supervisor);
    supervisor.kill('SIGKILL');
    await forcedExit;
  }
}

async function within(promise, milliseconds, message) {
  const controller = new AbortController();
  try {
    return await Promise.race([
      promise,
      delay(milliseconds, undefined, { signal: controller.signal }).then(() => { throw new Error(message); }),
    ]);
  } finally {
    controller.abort();
  }
}

async function portIsFree(port) {
  const server = http.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function portsAreFree() {
  for (const port of [config.bffPort, config.mastraPort, config.supervisorPort]) {
    try {
      await portIsFree(port);
    } catch (error) {
      if (error.code === 'EADDRINUSE') throw new Error(`Refusing to replace a process on port ${port}`);
      throw error;
    }
  }
}

async function postgresWasRunning() {
  const child = spawn('docker', ['compose', 'ps', '--status', 'running', '--services'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`docker compose ps exited ${code}`)));
  });
  return output.split(/\r?\n/).includes('postgres');
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function request(path, options) {
  return fetch(new URL(path, bffUrl), options);
}

async function mastraRequest(path, options) {
  return fetch(new URL(path, mastraUrl), options);
}

function semanticEvent(event) {
  if (event.kind === 'workflow-step-suspended') return { ...event, kind: 'workflow.suspended' };
  if (event.kind === 'workflow-finish' && event.chunk?.payload?.workflowStatus === 'success') {
    return { ...event, kind: 'workflow.completed' };
  }
  return event;
}

async function nextEvents(runId, after, matches, timeout = 5_000, opened, controller = new AbortController()) {
  let cursor = after;
  let timedOut = false;
  let reader;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  try {
    for (;;) {
      const before = cursor;
      const response = await request(`/api/runs/${encodeURIComponent(runId)}/events?after=${cursor}`, { signal: controller.signal });
      assert.equal(response.status, 200);
      assert.ok(response.body, 'SSE response must have a body');
      reader = response.body.getReader();
      opened?.();
      opened = undefined;
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const message = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = message.split('\n').find(line => line.startsWith('data: '));
          if (!data) continue;
          const event = semanticEvent(JSON.parse(data.slice(6)));
          assert.ok(event.sequence > cursor, `SSE sequence must increase: ${event.sequence} after ${cursor}`);
          cursor = event.sequence;
          if (matches(event)) {
            await reader.cancel().catch(() => {});
            reader = undefined;
            return event;
          }
        }
        if (done) break;
      }
      await reader.cancel().catch(() => {});
      reader = undefined;
      if (cursor === before) return undefined;
    }
  } catch (error) {
    if (timedOut || controller.signal.aborted) return undefined;
    throw error;
  } finally {
    clearTimeout(timer);
    await reader?.cancel().catch(() => {});
  }
}

function liveNextEvent(runId, after, matches) {
  const controller = new AbortController();
  let resolveOpened;
  let rejectOpened;
  let openedSettled = false;
  let openTimer;
  const settleOpened = (settle, value) => {
    if (openedSettled) return;
    openedSettled = true;
    clearTimeout(openTimer);
    settle(value);
  };
  const opened = new Promise((resolve, reject) => {
    resolveOpened = value => settleOpened(resolve, value);
    rejectOpened = error => settleOpened(reject, error);
  });
  opened.catch(() => {});
  const event = nextEvents(runId, after, matches, 5_000, resolveOpened, controller).then(value => {
    if (!openedSettled) rejectOpened(new Error('SSE closed before opening'));
    return value;
  }, error => {
    rejectOpened(error);
    throw error;
  });
  openTimer = setTimeout(() => {
    controller.abort();
    rejectOpened(new Error('Timed out waiting for live SSE'));
  }, 5_000);
  return {
    opened,
    event,
    async cancel() {
      if (!openedSettled) resolveOpened();
      controller.abort();
      await event.catch(() => {});
    },
  };
}

async function scalar(pool, sql) {
  await assertScratchDatabase(pool);
  const { rows: [row] } = await pool.query(sql);
  return { value: String(Object.values(row)[0]) };
}

async function countForRun(pool, table, runId) {
  await assertScratchDatabase(pool);
  const { rows: [row] } = await pool.query(`select count(*) from topology_factory.${table} where run_id = $1`, [runId]);
  return Number(row.count);
}

async function markWorkflowRunning(pool, runId) {
  const result = await pool.query(
    `update topology_mastra."mastra_workflow_snapshot"
     set snapshot = jsonb_set(snapshot, '{status}', '"running"'::jsonb)
     where workflow_name = 'topology-workflow' and run_id = $1 and snapshot->>'status' = 'suspended'
     returning snapshot->>'status' as status`,
    [runId],
  );
  assert.equal(result.rowCount, 1, 'Expected a suspended Mastra snapshot to mark running');
  assert.equal(result.rows[0].status, 'running');
}

async function startRun() {
  const start = await request('/api/runs', { method: 'POST', headers: operatorHeaders });
  assert.equal(start.status, 200);
  return start.json();
}

async function approve(runId, idempotencyKey) {
  return request(`/api/runs/${runId}/commands`, {
    method: 'POST',
    headers: { ...operatorHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'approve', idempotencyKey }),
  });
}

async function main() {
  let pool;
  let supervisor;
  let startedPostgres = false;
  let failure;
  try {
    await portsAreFree();
    startedPostgres = !await postgresWasRunning();
    await run('docker', ['compose', 'up', '-d', '--wait', 'postgres'], { stdio: 'inherit' });
    pool = createPool();
    await assertScratchDatabase(pool);
    await resetSchemas(pool);
    supervisor = spawn(process.execPath, ['src/supervisor.mjs'], { stdio: 'inherit' });
    await Promise.all([waitFor(`${bffUrl}/health`), waitFor(`${mastraUrl}/health`)]);

    const serviceHeaders = { authorization: `Bearer ${config.serviceToken}`, 'content-type': 'application/json' };
    for (const body of ['null', '{']) {
      const invalidStart = await mastraRequest('/runs', { method: 'POST', headers: serviceHeaders, body });
      assert.equal(invalidStart.status, 400);
      const invalidResume = await mastraRequest('/runs/invalid/resume', { method: 'POST', headers: serviceHeaders, body });
      assert.equal(invalidResume.status, 400);
    }
    for (const url of [
      `${bffUrl}/api/runs/invalid/events?after=2147483648`,
      `${mastraUrl}/runs/invalid/events?after=2147483648`,
    ]) {
      const response = await fetch(url, { headers: url.startsWith(mastraUrl) ? serviceHeaders : undefined });
      assert.equal(response.status, 400);
    }
    for (const body of ['null', '{']) {
      const invalidCommand = await request('/api/runs/invalid/commands', {
        method: 'POST', headers: { ...operatorHeaders, 'content-type': 'application/json' }, body,
      });
      assert.equal(invalidCommand.status, 400);
    }
    assert.equal((await fetch(`${bffUrl}/health`)).status, 200);
    assert.equal((await fetch(`${mastraUrl}/health`)).status, 200);
    assert.ok(!(await (await fetch(bffUrl)).text()).includes(config.serviceToken), 'BFF page must not expose the service token');

    const failedResumeId = 'missing-durable-run';
    await pool.query(
      "insert into topology_factory.missions (run_id, mission_id, status, gate) values ($1, $1, 'running', 'pending')",
      [failedResumeId],
    );
    const failedResume = await approve(failedResumeId, 'resume-missing');
    assert.notEqual(failedResume.status, 200);
    assert.equal((await scalar(pool, `select gate from topology_factory.missions where run_id = '${failedResumeId}'`)).value, 'pending');
    assert.equal((await scalar(pool, `select count(*) from topology_factory.commands where run_id = '${failedResumeId}'`)).value, '0');

    const { runId } = await startRun();
    const pending = await nextEvents(runId, 0, event => event.kind === 'workflow.suspended');
    assert.equal(pending.runId, runId);

    const approval = await approve(runId, 'approve-1');
    assert.equal(approval.status, 200, await approval.text());
    const completed = await nextEvents(runId, pending.sequence, event => event.kind === 'workflow.completed');
    assert.equal(completed.runId, runId);
    assert.equal((await scalar(pool, 'select count(*) from topology_factory.effects')).value, '1');

    const denied = await request(`/api/runs/${runId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'approve', idempotencyKey: 'denied-1' }),
    });
    assert.equal(denied.status, 401);

    const duplicate = await approve(runId, 'approve-1');
    assert.equal(duplicate.status, 200);
    assert.equal((await scalar(pool, 'select count(*) from topology_factory.effects')).value, '1');
    const stale = await approve(runId, 'approve-stale');
    assert.equal(stale.status, 409);

    const effectWithoutFinish = await startRun();
    const effectWithoutFinishPending = await nextEvents(effectWithoutFinish.runId, 0, event => event.kind === 'workflow.suspended');
    await pool.query(
      'insert into topology_factory.effects (idempotency_key, run_id) values ($1, $2)',
      [`${effectWithoutFinish.runId}:publish`, effectWithoutFinish.runId],
    );
    assert.equal(await nextEvents(effectWithoutFinish.runId, effectWithoutFinishPending.sequence, event => event.kind === 'workflow.completed', 250), undefined);
    await markWorkflowRunning(pool, effectWithoutFinish.runId);
    const liveCompletion = liveNextEvent(
      effectWithoutFinish.runId,
      effectWithoutFinishPending.sequence,
      event => event.kind === 'workflow.completed',
    );
    try {
      await liveCompletion.opened;
      const effectRecovery = await approve(effectWithoutFinish.runId, 'recover-effect-without-finish');
      const effectRecoveryBody = await effectRecovery.text();
      assert.equal(effectRecovery.status, 200, effectRecoveryBody);
      assert.equal(JSON.parse(effectRecoveryBody).gate, 'satisfied');
      assert.equal((await liveCompletion.event).runId, effectWithoutFinish.runId);
      assert.equal((await scalar(pool, `select count(*) from topology_mastra.events where run_id = '${effectWithoutFinish.runId}' and kind = 'workflow-finish' and payload->'chunk'->'payload'->>'workflowStatus' = 'success'`)).value, '1');
      assert.equal(await countForRun(pool, 'effects', effectWithoutFinish.runId), 1);
    } finally {
      await liveCompletion.cancel();
    }

    const recoveredRunId = 'failed-effect-before-confirmation';
    await pool.query(
      "insert into topology_factory.missions (run_id, mission_id, status, gate) values ($1, $1, 'running', 'pending')",
      [recoveredRunId],
    );
    await pool.query(
      'insert into topology_factory.effects (idempotency_key, run_id) values ($1, $2)',
      [`${recoveredRunId}:publish`, recoveredRunId],
    );
    await pool.query(
      `insert into topology_mastra.events (run_id, sequence, kind, payload)
       values ($1, 1, 'workflow-finish', $2)`,
      [recoveredRunId, { chunk: { type: 'workflow-finish', payload: { workflowStatus: 'failed' } } }],
    );
    const failedTerminal = await within(
      mastraRequest(`/runs/${encodeURIComponent(recoveredRunId)}/events?after=0`, {
        headers: { authorization: `Bearer ${config.serviceToken}` },
      }).then(async response => {
        assert.equal(response.status, 200);
        return response.text();
      }),
      2_000,
      'Failed workflow finish left its SSE stream open',
    );
    assert.match(failedTerminal, /workflow-finish/);
    const recovered = await approve(recoveredRunId, 'recover-command');
    assert.notEqual(recovered.status, 200);
    assert.equal(await countForRun(pool, 'commands', recoveredRunId), 1);
    assert.equal((await scalar(pool, `select accepted from topology_factory.commands where run_id = '${recoveredRunId}'`)).value, 'false');
    assert.equal((await scalar(pool, `select gate from topology_factory.missions where run_id = '${recoveredRunId}'`)).value, 'pending');
    assert.equal((await scalar(pool, `select status from topology_factory.missions where run_id = '${recoveredRunId}'`)).value, 'failed');

    const abandoned = await startRun();
    const abandonedPending = await nextEvents(abandoned.runId, 0, event => event.kind === 'workflow.suspended');
    assert.equal(abandonedPending.runId, abandoned.runId);
    await pool.query(
      "insert into topology_factory.commands (idempotency_key, run_id, command, accepted) values ($1, $2, 'approve', false)",
      ['approve-abandoned', abandoned.runId],
    );
    const abandonedRestart = await fetch(`${supervisorUrl}/admin/restart/bff`, { method: 'POST' });
    assert.equal(abandonedRestart.status, 202);
    await waitFor(`${bffUrl}/health`);
    const abandonedRetry = await approve(abandoned.runId, 'approve-abandoned');
    assert.equal(abandonedRetry.status, 200);
    const abandonedCompleted = await nextEvents(abandoned.runId, abandonedPending.sequence, event => event.kind === 'workflow.completed');
    assert.equal(abandonedCompleted.runId, abandoned.runId);
    assert.equal(await countForRun(pool, 'commands', abandoned.runId), 1);
    assert.equal(await countForRun(pool, 'effects', abandoned.runId), 1);

    const concurrent = await startRun();
    const concurrentPending = await nextEvents(concurrent.runId, 0, event => event.kind === 'workflow.suspended');
    const concurrentApprovals = await within(
      Promise.all(Array.from({ length: 10 }, () => approve(concurrent.runId, 'approve-concurrent'))),
      5_000,
      'Concurrent approvals deadlocked',
    );
    for (const response of concurrentApprovals) assert.equal(response.status, 200);
    const concurrentCompleted = await nextEvents(concurrent.runId, concurrentPending.sequence, event => event.kind === 'workflow.completed');
    assert.equal(concurrentCompleted.runId, concurrent.runId);
    assert.equal(await countForRun(pool, 'commands', concurrent.runId), 1);
    assert.equal(await countForRun(pool, 'effects', concurrent.runId), 1);

    const manyRuns = await within(
      Promise.all(Array.from({ length: 12 }, () => startRun())),
      10_000,
      'Concurrent Run creation deadlocked',
    );
    const manyPending = await within(
      Promise.all(manyRuns.map(run => nextEvents(run.runId, 0, event => event.kind === 'workflow.suspended'))),
      10_000,
      'Concurrent Run suspension deadlocked',
    );
    const manyApprovals = await within(
      Promise.all(manyRuns.map((run, index) => approve(run.runId, `approve-many-${index}`))),
      10_000,
      'Concurrent Run approval deadlocked',
    );
    for (const response of manyApprovals) assert.equal(response.status, 200);
    const manyCompleted = await within(
      Promise.all(manyRuns.map((run, index) => nextEvents(run.runId, manyPending[index].sequence, event => event.kind === 'workflow.completed'))),
      10_000,
      'Concurrent Run completion deadlocked',
    );
    for (const [index, completedRun] of manyCompleted.entries()) {
      assert.equal(completedRun.runId, manyRuns[index].runId);
      assert.equal(await countForRun(pool, 'commands', manyRuns[index].runId), 1);
      assert.equal(await countForRun(pool, 'effects', manyRuns[index].runId), 1);
    }

    const replay = await nextEvents(runId, completed.sequence, () => true, 250);
    assert.equal(replay, undefined);
    await delay(50);
    const bffHealth = await fetch(`${bffUrl}/health`).catch(() => undefined);
    assert.equal(bffHealth?.status, 200, 'BFF must survive an SSE client disconnect');

    const second = await startRun();
    const secondPending = await nextEvents(second.runId, 0, event => event.kind === 'workflow.suspended');
    assert.equal(secondPending.runId, second.runId);
    const bffRestarts = await Promise.all(Array.from({ length: 10 }, () => fetch(`${supervisorUrl}/admin/restart/bff`, { method: 'POST' })));
    for (const bffRestart of bffRestarts) assert.equal(bffRestart.status, 202);
    await waitFor(`${bffUrl}/health`);
    const reconnected = await nextEvents(second.runId, 0, event => event.kind === 'workflow.suspended');
    assert.equal(reconnected.runId, second.runId);

    const third = await startRun();
    const thirdPending = await nextEvents(third.runId, 0, event => event.kind === 'workflow.suspended');
    assert.equal(thirdPending.runId, third.runId);
    const mastraRestart = await fetch(`${supervisorUrl}/admin/restart/mastra`, { method: 'POST' });
    assert.equal(mastraRestart.status, 202);
    await waitFor(`${mastraUrl}/health`);
    const restartedApproval = await approve(third.runId, 'approve-3');
    assert.equal(restartedApproval.status, 200);
    const restartedCompletion = await nextEvents(third.runId, thirdPending.sequence, event => event.kind === 'workflow.completed');
    assert.equal(restartedCompletion.runId, third.runId);

    const shutdown = await startRun();
    const shutdownSse = await request(`/api/runs/${encodeURIComponent(shutdown.runId)}/events?after=0`);
    assert.equal(shutdownSse.status, 200);
    await within(stopSupervisor(supervisor), 2_500, 'Supervisor waited for an open SSE before forcing its children');
    supervisor = undefined;
    await portsAreFree();
    await shutdownSse.body.cancel().catch(() => {});
  } catch (error) {
    failure = error;
  } finally {
    for (const cleanup of [
      () => stopSupervisor(supervisor),
      () => portsAreFree(),
      () => pool && resetSchemas(pool),
      () => closePool(pool),
      () => startedPostgres && run('docker', ['compose', 'stop', 'postgres'], { stdio: 'inherit' }),
    ]) {
      try {
        await cleanup();
      } catch (cleanupError) {
        if (failure) console.error(cleanupError);
        else failure = cleanupError;
      }
    }
  }
  if (failure) throw failure;
}

main().catch(error => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
