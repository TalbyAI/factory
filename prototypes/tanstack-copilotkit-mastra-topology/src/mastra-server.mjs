import http from 'node:http';
import { Mastra } from '@mastra/core/mastra';
import { PostgresStore } from '@mastra/pg';
import { config } from './config.mjs';
import { appendEvent, createPool, eventsAfter } from './db.mjs';
import { makeWorkflow } from './mastra-workflow.mjs';
import { json, readJson, sseHeaders, writeEvent } from './protocol.mjs';

const subscribers = new Map();
const activeRuns = new Map();
const maxCursor = 2_147_483_647;

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

function terminal(chunk) {
  return chunk.type === 'workflow.error' || (
    chunk.type === 'workflow-finish' && chunk.payload?.workflowStatus !== 'suspended'
  );
}

function unsubscribe(runId, subscriber) {
  const list = subscribers.get(runId);
  if (!list) return;
  list.delete(subscriber);
  if (!list.size) subscribers.delete(runId);
}

function writeOnce(runId, subscriber, event) {
  if (subscriber.closed || subscriber.sequences.has(event.sequence)) return;
  subscriber.sequences.add(event.sequence);
  writeEvent(subscriber.res, event);
  if (terminal(event.chunk)) {
    subscriber.closed = true;
    subscriber.res.end();
    unsubscribe(runId, subscriber);
  }
}

async function createServerState() {
  const pool = createPool();
  const storage = new PostgresStore({
    id: 'topology-mastra',
    connectionString: config.databaseUrl,
    schemaName: 'topology_mastra',
  });
  await storage.init();
  const mastra = new Mastra({ storage, workflows: { 'topology-workflow': makeWorkflow(pool) } });
  return { pool, storage, mastra };
}

async function main() {
  const { pool, storage, mastra } = await createServerState();

  async function publishChunk(runId, chunk) {
    const event = await appendEvent(pool, runId, chunk.type, { chunk });
    for (const subscriber of [...(subscribers.get(runId) ?? [])]) {
      if (subscriber.closed || event.sequence <= subscriber.after) continue;
      if (subscriber.replaying) subscriber.pending.set(event.sequence, event);
      else writeOnce(runId, subscriber, event);
    }
    return event;
  }

  async function consume(runId, output) {
    let publishedError = false;
    try {
      for await (const chunk of output.fullStream) {
        if (chunk.type === 'workflow.error') publishedError = true;
        await publishChunk(runId, chunk);
      }
      const result = await output.result;
      if (result.status === 'failed') throw result.error;
      return result;
    } catch (error) {
      if (!publishedError) await publishChunk(runId, { type: 'workflow.error', error: error.message });
      throw error;
    } finally {
      activeRuns.delete(runId);
    }
  }

  async function startRun(runId) {
    let output;
    try {
      const workflow = mastra.getWorkflow('topology-workflow');
      const run = await workflow.createRun({ runId });
      output = run.stream({ inputData: { runId }, closeOnSuspend: true });
      activeRuns.set(runId, output);
      return await consume(runId, output);
    } catch (error) {
      if (!output) await publishChunk(runId, { type: 'workflow.error', error: error.message });
      throw error;
    }
  }

  async function resumeRun(runId, resumeData) {
    let output;
    try {
      const workflow = mastra.getWorkflow('topology-workflow');
      const run = await workflow.createRun({ runId });
      output = run.resumeStream({ step: 'operator-gate', resumeData });
      activeRuns.set(runId, output);
      return await consume(runId, output);
    } catch (error) {
      if (!output) await publishChunk(runId, { type: 'workflow.error', error: error.message });
      throw error;
    }
  }

  async function streamEvents(res, runId, after) {
    sseHeaders(res);
    const subscriber = { res, after, sequences: new Set(), pending: new Map(), replaying: true, closed: false };
    const list = subscribers.get(runId) ?? new Set();
    list.add(subscriber);
    subscribers.set(runId, list);
    res.on('close', () => {
      subscriber.closed = true;
      unsubscribe(runId, subscriber);
    });
    const events = await eventsAfter(pool, runId, after);
    const replay = new Map(events.map(event => [event.sequence, event]));
    for (const [sequence, event] of subscriber.pending) replay.set(sequence, event);
    subscriber.pending.clear();
    for (const event of [...replay.values()].sort((left, right) => Number(left.sequence) - Number(right.sequence))) writeOnce(runId, subscriber, event);
    subscriber.replaying = false;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
      if (req.method === 'POST' && url.pathname === '/runs') {
        if (!authorizedService(req)) return json(res, 401, { error: 'service authorization required' });
        const { runId } = await readObject(req);
        if (typeof runId !== 'string' || !runId) return json(res, 400, { error: 'runId is required' });
        await startRun(runId);
        return json(res, 200, { runId, workflowId: 'topology-workflow' });
      }
      const resume = url.pathname.match(/^\/runs\/([^/]+)\/resume$/);
      if (req.method === 'POST' && resume) {
        if (!authorizedService(req)) return json(res, 401, { error: 'service authorization required' });
        const body = await readObject(req);
        if (body.command !== 'approve' || typeof body.idempotencyKey !== 'string' || !body.idempotencyKey) return json(res, 400, { error: 'approve command and idempotencyKey are required' });
        const runId = decodeURIComponent(resume[1]);
        await resumeRun(runId, body);
        return json(res, 200, { runId, accepted: true });
      }
      const events = url.pathname.match(/^\/runs\/([^/]+)\/events$/);
      if (req.method === 'GET' && events) {
        if (!authorizedService(req)) return json(res, 401, { error: 'service authorization required' });
        const after = cursor(url);
        if (after === undefined) return json(res, 400, { error: 'after must be a non-negative integer within PostgreSQL range' });
        return await streamEvents(res, decodeURIComponent(events[1]), after);
      }
      return json(res, 404, { error: 'not found' });
    } catch (error) {
      if (!res.headersSent) return json(res, error.statusCode ?? 500, { error: error.message });
      res.destroy();
    }
  });

  server.listen(config.mastraPort, '127.0.0.1');
  process.once('SIGINT', async () => {
    server.close();
    await storage.close();
    await pool.end();
  });
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
