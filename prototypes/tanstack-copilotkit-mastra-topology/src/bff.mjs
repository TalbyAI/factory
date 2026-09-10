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

function authorizedOperator(req) {
  return req.headers['x-operator-key'] === operatorKey;
}

function authorizedService(req) {
  return req.headers.authorization === `Bearer ${config.serviceToken}`;
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
    if (downstreamClosed && (
      error?.name === 'AbortError'
      || error?.code === 'ERR_STREAM_PREMATURE_CLOSE'
      || error?.code === 'ERR_STREAM_DESTROYED'
    )) return;
    throw error;
  } finally {
    req.off('aborted', disconnect);
    res.off('close', disconnect);
  }
}

async function approve(pool, res, runId, body) {
  if (body.command !== 'approve' || typeof body.idempotencyKey !== 'string' || !body.idempotencyKey) {
    return json(res, 409, { error: 'Only approve with an idempotencyKey is accepted' });
  }
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('begin');
    inTransaction = true;
    const command = await client.query(
      `insert into topology_factory.commands (idempotency_key, run_id, command, accepted)
       values ($1, $2, 'approve', true) on conflict (idempotency_key) do nothing
       returning idempotency_key`,
      [body.idempotencyKey, runId],
    );
    if (!command.rowCount) {
      const { rows: [existingCommand] } = await client.query(
        'select run_id, command from topology_factory.commands where idempotency_key = $1',
        [body.idempotencyKey],
      );
      await client.query('rollback');
      inTransaction = false;
      if (existingCommand?.run_id === runId && existingCommand.command === 'approve') {
        return json(res, 200, { runId, accepted: true, gate: 'satisfied' });
      }
      return json(res, 409, { error: 'Idempotency key belongs to another Run' });
    }
    const { rows: [mission] } = await client.query(
      'select gate from topology_factory.missions where run_id = $1 for update',
      [runId],
    );
    if (!mission || mission.gate !== 'pending') {
      await client.query('rollback');
      inTransaction = false;
      return json(res, 409, { error: 'Gate is not pending' });
    }
    const upstream = await fetch(`${mastraUrl}/runs/${encodeURIComponent(runId)}/resume`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.serviceToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'approve', idempotencyKey: body.idempotencyKey }),
    });
    if (!upstream.ok) {
      await client.query('rollback');
      inTransaction = false;
      return json(res, upstream.status, { error: 'Mastra did not resume the Run' });
    }
    await client.query("update topology_factory.missions set gate = 'satisfied' where run_id = $1", [runId]);
    await client.query('commit');
    inTransaction = false;
    return json(res, 200, { runId, accepted: true, gate: 'satisfied' });
  } catch (error) {
    if (inTransaction) await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function recordEffect(pool, req, res) {
  const idempotencyKey = req.headers['idempotency-key'];
  const body = await readJson(req);
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
        return startRun(pool, res);
      }
      const events = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
      if (req.method === 'GET' && events) {
        const after = Number(url.searchParams.get('after') ?? 0);
        if (!Number.isInteger(after) || after < 0) return json(res, 400, { error: 'after must be a non-negative integer' });
        return await proxyEvents(req, res, decodeURIComponent(events[1]), after);
      }
      const commands = url.pathname.match(/^\/api\/runs\/([^/]+)\/commands$/);
      if (req.method === 'POST' && commands) {
        if (!authorizedOperator(req)) return json(res, 401, { error: 'operator authorization required' });
        return approve(pool, res, decodeURIComponent(commands[1]), await readJson(req));
      }
      if (req.method === 'POST' && url.pathname === '/internal/effects') {
        if (!authorizedService(req)) return json(res, 401, { error: 'service authorization required' });
        return recordEffect(pool, req, res);
      }
      return json(res, 404, { error: 'not found' });
    } catch (error) {
      if (!res.headersSent) return json(res, 500, { error: error.message });
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
