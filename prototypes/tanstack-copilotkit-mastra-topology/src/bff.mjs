import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { Readable } from 'node:stream';
import { config } from './config.mjs';
import { createPool } from './db.mjs';
import { json, readJson } from './protocol.mjs';

const operatorKey = 'prototype-operator-key';
const mastraUrl = `http://127.0.0.1:${config.mastraPort}`;
const page = new URL('../public/index.html', import.meta.url);
const maxCursor = 2_147_483_647;
const approvalLocks = new Map();

function authorizedOperator(req) {
  return req.headers['x-operator-key'] === operatorKey;
}

function authorizedService(req) {
  return req.headers.authorization === `Bearer ${config.serviceToken}`;
}

async function readObject(req) {
  try {
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('request body must be a JSON object');
    return body;
  } catch (error) {
    error.statusCode = 400;
    throw error;
  }
}

function cursor(url) {
  const after = Number(url.searchParams.get('after') ?? 0);
  return Number.isSafeInteger(after) && after >= 0 && after <= maxCursor ? after : undefined;
}

async function startRun(pool, res) {
  const runId = randomUUID();
  await pool.query(
    `insert into topology_factory.missions (run_id, mission_id, status, gate)
     values ($1, $2, 'running', 'pending')`,
    [runId, runId],
  );
  try {
    const upstream = await fetch(`${mastraUrl}/runs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.serviceToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ runId }),
    });
    if (!upstream.ok) {
      await pool.query('update topology_factory.missions set status = $1 where run_id = $2', ['failed', runId]);
      return json(res, upstream.status, { error: 'Mastra did not start the Run' });
    }
  } catch {
    await pool.query('update topology_factory.missions set status = $1 where run_id = $2', ['failed', runId]);
    return json(res, 502, { error: 'Mastra did not start the Run' });
  }
  return json(res, 200, { runId });
}

async function proxyEvents(req, res, runId, after) {
  const controller = new AbortController();
  let downstreamClosed = false;
  const disconnect = () => {
    if (downstreamClosed) return;
    downstreamClosed = true;
    controller.abort();
  };
  req.once('aborted', disconnect);
  res.once('close', disconnect);
  try {
    const upstream = await fetch(`${mastraUrl}/runs/${encodeURIComponent(runId)}/events?after=${after}`, {
      headers: { authorization: `Bearer ${config.serviceToken}` },
      signal: controller.signal,
    });
    if (!upstream.ok || !upstream.body) return json(res, upstream.status, { error: 'Mastra event stream unavailable' });
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
      'cache-control': upstream.headers.get('cache-control') ?? 'no-cache',
      connection: 'keep-alive',
    });
    const body = Readable.fromWeb(upstream.body);
    body.on('error', () => {});
    for await (const chunk of body) {
      if (!res.write(chunk)) {
        await new Promise((resolve, reject) => {
          const cleanup = () => {
            body.off('error', onError);
            res.off('drain', onDrain);
            res.off('close', onClose);
          };
          const onDrain = () => { cleanup(); resolve(); };
          const onClose = () => { cleanup(); resolve(); };
          const onError = error => { cleanup(); reject(error); };
          body.once('error', onError);
          res.once('drain', onDrain);
          res.once('close', onClose);
        });
        if (downstreamClosed) return;
      }
    }
    res.end();
  } catch (error) {
    if (downstreamClosed || res.destroyed) return;
    throw error;
  } finally {
    req.off('aborted', disconnect);
    res.off('close', disconnect);
  }
}

async function withRunLock(runId, action) {
  const previous = approvalLocks.get(runId);
  let release;
  const current = new Promise(resolve => { release = resolve; });
  approvalLocks.set(runId, current);
  if (previous) await previous;
  try {
    return await action();
  } finally {
    release();
    if (approvalLocks.get(runId) === current) approvalLocks.delete(runId);
  }
}

async function reserveApproval(pool, runId, idempotencyKey) {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('begin');
    inTransaction = true;
    const command = await client.query(
      `insert into topology_factory.commands (idempotency_key, run_id, command, accepted)
       values ($1, $2, 'approve', false) on conflict (idempotency_key) do nothing
       returning idempotency_key`,
      [idempotencyKey, runId],
    );
    if (!command.rowCount) {
      const { rows: [existingCommand] } = await client.query(
        'select run_id, command, accepted from topology_factory.commands where idempotency_key = $1',
        [idempotencyKey],
      );
      if (existingCommand?.run_id !== runId || existingCommand.command !== 'approve') {
        await client.query('rollback');
        inTransaction = false;
        return { state: 'conflict' };
      }
      if (existingCommand.accepted) {
        await client.query('rollback');
        inTransaction = false;
        return { state: 'accepted' };
      }
    }
    const { rows: [mission] } = await client.query(
      'select gate from topology_factory.missions where run_id = $1 for update',
      [runId],
    );
    if (!mission || mission.gate !== 'pending') {
      await client.query('delete from topology_factory.commands where idempotency_key = $1 and accepted = false', [idempotencyKey]);
      await client.query('commit');
      inTransaction = false;
      return { state: 'stale' };
    }
    if (command.rowCount && (await client.query(
      "select 1 from topology_factory.commands where run_id = $1 and command = 'approve' and idempotency_key <> $2 limit 1",
      [runId, idempotencyKey],
    )).rowCount) {
      await client.query('delete from topology_factory.commands where idempotency_key = $1 and accepted = false', [idempotencyKey]);
      await client.query('commit');
      inTransaction = false;
      return { state: 'pending' };
    }
    await client.query('commit');
    inTransaction = false;
    return { state: 'reserved' };
  } catch (error) {
    if (inTransaction) await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function releaseApproval(pool, runId, idempotencyKey) {
  await pool.query(
    `delete from topology_factory.commands
     where idempotency_key = $1 and run_id = $2 and command = 'approve' and accepted = false`,
    [idempotencyKey, runId],
  );
}

async function confirmApproval(pool, runId, idempotencyKey) {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('begin');
    inTransaction = true;
    const { rows: [mission] } = await client.query(
      'select gate from topology_factory.missions where run_id = $1 for update',
      [runId],
    );
    if (!mission || !['pending', 'satisfied'].includes(mission.gate)) throw new Error('Gate is not pending');
    await client.query(
      "update topology_factory.commands set accepted = true where idempotency_key = $1 and run_id = $2 and command = 'approve'",
      [idempotencyKey, runId],
    );
    await client.query("update topology_factory.missions set gate = 'satisfied' where run_id = $1", [runId]);
    await client.query('commit');
    inTransaction = false;
  } catch (error) {
    if (inTransaction) await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function effectExists(pool, runId) {
  const result = await pool.query('select 1 from topology_factory.effects where run_id = $1 limit 1', [runId]);
  return result.rowCount === 1;
}

async function durableWorkflowStatus(runId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  let reader;
  try {
    const upstream = await fetch(`${mastraUrl}/runs/${encodeURIComponent(runId)}/events?after=0`, {
      headers: { authorization: `Bearer ${config.serviceToken}` },
      signal: controller.signal,
    });
    if (!upstream.ok || !upstream.body) throw new Error('Mastra event stream unavailable');
    reader = upstream.body.getReader();
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
        const event = JSON.parse(data.slice(6));
        if (event.kind === 'workflow.error' || event.chunk?.type === 'workflow.error') return 'failed';
        if (event.kind === 'workflow-finish') {
          const status = event.chunk?.payload?.workflowStatus;
          if (status === 'success') return 'success';
          if (status === 'failed' || status === 'error') return 'failed';
        }
      }
      if (done) return 'pending';
    }
  } catch (error) {
    if (error?.name === 'AbortError') return 'pending';
    throw error;
  } finally {
    clearTimeout(timeout);
    await reader?.cancel().catch(() => {});
    controller.abort();
  }
}

async function releaseApprovalIfSafe(pool, runId, idempotencyKey) {
  if (!await effectExists(pool, runId)) await releaseApproval(pool, runId, idempotencyKey);
}

async function failMission(pool, runId) {
  await pool.query("update topology_factory.missions set status = 'failed' where run_id = $1", [runId]);
}

async function approve(pool, res, runId, body) {
  if (body.command !== 'approve' || typeof body.idempotencyKey !== 'string' || !body.idempotencyKey) {
    return json(res, 409, { error: 'Only approve with an idempotencyKey is accepted' });
  }
  return withRunLock(runId, async () => {
    const reservation = await reserveApproval(pool, runId, body.idempotencyKey);
    if (reservation.state === 'conflict') return json(res, 409, { error: 'Idempotency key belongs to another Run' });
    if (reservation.state === 'stale') return json(res, 409, { error: 'Gate is not pending' });
    if (reservation.state === 'accepted') return json(res, 200, { runId, accepted: true, gate: 'satisfied' });
    if (reservation.state === 'pending') return json(res, 409, { error: 'Command is pending' });
    try {
      if (await effectExists(pool, runId)) {
        const status = await durableWorkflowStatus(runId);
        if (status === 'success') {
          await confirmApproval(pool, runId, body.idempotencyKey);
          return json(res, 200, { runId, accepted: true, gate: 'satisfied' });
        }
        if (status === 'failed') {
          await failMission(pool, runId);
          await releaseApprovalIfSafe(pool, runId, body.idempotencyKey);
          return json(res, 503, { error: 'Durable workflow finished without success; retry recovery' });
        }
      }
      const upstream = await fetch(`${mastraUrl}/runs/${encodeURIComponent(runId)}/resume`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.serviceToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ command: 'approve', idempotencyKey: body.idempotencyKey }),
      });
      if (!upstream.ok) {
        try {
          const status = await durableWorkflowStatus(runId);
          if (status === 'success') {
            await confirmApproval(pool, runId, body.idempotencyKey);
            return json(res, 200, { runId, accepted: true, gate: 'satisfied' });
          }
          if (status === 'failed') {
            await failMission(pool, runId);
            await releaseApprovalIfSafe(pool, runId, body.idempotencyKey);
            return json(res, 503, { error: 'Durable workflow finished without success; retry recovery' });
          }
        } catch {}
        await releaseApprovalIfSafe(pool, runId, body.idempotencyKey);
        return json(res, upstream.status, { error: 'Mastra did not resume the Run' });
      }
      const status = await durableWorkflowStatus(runId);
      if (status === 'failed') {
        await failMission(pool, runId);
        await releaseApprovalIfSafe(pool, runId, body.idempotencyKey);
        return json(res, 503, { error: 'Durable workflow finished without success; retry recovery' });
      }
      if (status === 'success') {
        await confirmApproval(pool, runId, body.idempotencyKey);
        return json(res, 200, { runId, accepted: true, gate: 'satisfied' });
      }
      await releaseApprovalIfSafe(pool, runId, body.idempotencyKey);
      return json(res, 503, { error: 'Mastra resumed without a durable workflow finish; retry the command' });
    } catch (error) {
      await releaseApprovalIfSafe(pool, runId, body.idempotencyKey);
      throw error;
    }
  });
}

async function recordEffect(pool, req, res, body) {
  const idempotencyKey = req.headers['idempotency-key'];
  if (typeof idempotencyKey !== 'string' || !idempotencyKey || typeof body.runId !== 'string' || !body.runId) {
    return json(res, 400, { error: 'runId and Idempotency-Key are required' });
  }
  const result = await pool.query(
    `insert into topology_factory.effects (idempotency_key, run_id)
     values ($1, $2) on conflict (idempotency_key) do nothing returning idempotency_key`,
    [idempotencyKey, body.runId],
  );
  return json(res, 200, { effective: result.rowCount === 1 });
}

async function main() {
  const pool = createPool();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(await readFile(page));
      }
      if (req.method === 'POST' && url.pathname === '/api/runs') {
        if (!authorizedOperator(req)) return json(res, 401, { error: 'operator authorization required' });
        return await startRun(pool, res);
      }
      const events = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
      if (req.method === 'GET' && events) {
        const after = cursor(url);
        if (after === undefined) return json(res, 400, { error: 'after must be a non-negative integer within PostgreSQL range' });
        return await proxyEvents(req, res, decodeURIComponent(events[1]), after);
      }
      const commands = url.pathname.match(/^\/api\/runs\/([^/]+)\/commands$/);
      if (req.method === 'POST' && commands) {
        if (!authorizedOperator(req)) return json(res, 401, { error: 'operator authorization required' });
        return await approve(pool, res, decodeURIComponent(commands[1]), await readObject(req));
      }
      if (req.method === 'POST' && url.pathname === '/internal/effects') {
        if (!authorizedService(req)) return json(res, 401, { error: 'service authorization required' });
        return await recordEffect(pool, req, res, await readObject(req));
      }
      return json(res, 404, { error: 'not found' });
    } catch (error) {
      if (!res.headersSent) return json(res, error.statusCode ?? 500, { error: error.message });
      res.destroy();
    }
  });
  server.listen(config.bffPort, '127.0.0.1');
  process.once('SIGINT', async () => {
    server.close();
    await pool.end();
  });
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
