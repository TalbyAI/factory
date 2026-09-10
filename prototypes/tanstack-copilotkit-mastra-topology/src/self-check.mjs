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

function semanticEvent(event) {
  if (event.kind === 'workflow-step-suspended') return { ...event, kind: 'workflow.suspended' };
  if (event.kind === 'workflow-finish' && event.chunk?.payload?.workflowStatus === 'success') {
    return { ...event, kind: 'workflow.completed' };
  }
  return event;
}

async function nextEvents(runId, after, matches, timeout = 5_000) {
  let cursor = after;
  let timedOut = false;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  try {
    for (;;) {
      const before = cursor;
      const response = await request(`/api/runs/${encodeURIComponent(runId)}/events?after=${cursor}`, { signal: controller.signal });
      assert.equal(response.status, 200);
      const reader = response.body.getReader();
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
          cursor = Math.max(cursor, event.sequence);
          if (matches(event)) return event;
        }
        if (done) break;
      }
      if (cursor === before) return undefined;
    }
  } catch (error) {
    if (timedOut && error.name === 'AbortError') return undefined;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function scalar(pool, sql) {
  await assertScratchDatabase(pool);
  const { rows: [row] } = await pool.query(sql);
  return { value: String(Object.values(row)[0]) };
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
    if (!await postgresWasRunning()) {
      await run('docker', ['compose', 'up', '-d', 'postgres'], { stdio: 'inherit' });
      startedPostgres = true;
    }
    pool = createPool();
    await assertScratchDatabase(pool);
    await resetSchemas(pool);
    supervisor = spawn(process.execPath, ['src/supervisor.mjs'], { stdio: 'inherit' });
    await Promise.all([waitFor(`${bffUrl}/health`), waitFor(`${mastraUrl}/health`)]);

    const { runId } = await startRun();
    const pending = await nextEvents(runId, 0, event => event.kind === 'workflow.suspended');
    assert.equal(pending.runId, runId);

    const approval = await approve(runId, 'approve-1');
    assert.equal(approval.status, 200);
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

    const replay = await nextEvents(runId, completed.sequence, () => true, 250);
    assert.equal(replay, undefined);
    await delay(50);
    const bffHealth = await fetch(`${bffUrl}/health`).catch(() => undefined);
    assert.equal(bffHealth?.status, 200, 'BFF must survive an SSE client disconnect');

    const second = await startRun();
    const secondPending = await nextEvents(second.runId, 0, event => event.kind === 'workflow.suspended');
    assert.equal(secondPending.runId, second.runId);
    const bffRestart = await fetch(`${supervisorUrl}/admin/restart/bff`, { method: 'POST' });
    assert.equal(bffRestart.status, 202);
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
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (supervisor?.exitCode === null) {
        const stopped = new Promise(resolve => supervisor.once('exit', resolve));
        supervisor.kill('SIGINT');
        await stopped;
      }
      if (pool) await resetSchemas(pool);
      await closePool(pool);
      if (startedPostgres) await run('docker', ['compose', 'stop', 'postgres'], { stdio: 'inherit' });
    } catch (cleanupError) {
      if (failure) console.error(cleanupError);
      else failure = cleanupError;
    }
  }
  if (failure) throw failure;
}

main().catch(error => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
