import http from 'node:http';
import { Mastra } from '@mastra/core/mastra';
import { PostgresStore } from '@mastra/pg';
import { config } from './config.mjs';
import { appendEvent, createPool, eventsAfter } from './db.mjs';
import { makeWorkflow } from './mastra-workflow.mjs';
import { json, readJson, sseHeaders, writeEvent } from './protocol.mjs';

const subscribers = new Map();
const activeRuns = new Map();

function terminal(chunk) {
  return chunk.type === 'workflow-finish' || chunk.type === 'workflow.error';
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
      if (subscriber.closed) continue;
      if (subscriber.replaying) subscriber.pending.set(event.sequence, event);
      else writeOnce(runId, subscriber, event);
    }
    return event;
  }

  async function consume(runId, output) {
    try {
      for await (const chunk of output.fullStream) await publishChunk(runId, chunk);
      await output.result;
    } catch (error) {
      await publishChunk(runId, { type: 'workflow.error', error: error.message });
    } finally {
      activeRuns.delete(runId);
    }
  }

  async function startRun(runId) {
    const workflow = mastra.getWorkflow('topology-workflow');
    const run = await workflow.createRun({ runId });
    const output = run.stream({ inputData: { runId }, closeOnSuspend: true });
    activeRuns.set(runId, output);
    void consume(runId, output);
  }

  async function resumeRun(runId, resumeData) {
    const workflow = mastra.getWorkflow('topology-workflow');
    const run = await workflow.createRun({ runId });
    const output = run.resumeStream({ step: 'operator-gate', resumeData });
    activeRuns.set(runId, output);
    void consume(runId, output);
  }

  async function streamEvents(res, runId, after) {
    sseHeaders(res);
    const subscriber = { res, sequences: new Set(), pending: new Map(), replaying: true, closed: false };
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
        const { runId } = await readJson(req);
        if (typeof runId !== 'string' || !runId) return json(res, 400, { error: 'runId is required' });
        void startRun(runId).catch(error => publishChunk(runId, { type: 'workflow.error', error: error.message }));
        return json(res, 202, { runId, workflowId: 'topology-workflow' });
      }
      const resume = url.pathname.match(/^\/runs\/([^/]+)\/resume$/);
      if (req.method === 'POST' && resume) {
        const body = await readJson(req);
        if (body.command !== 'approve' || typeof body.idempotencyKey !== 'string' || !body.idempotencyKey) return json(res, 400, { error: 'approve command and idempotencyKey are required' });
        const runId = decodeURIComponent(resume[1]);
        void resumeRun(runId, body).catch(error => publishChunk(runId, { type: 'workflow.error', error: error.message }));
        return json(res, 202, { runId, accepted: true });
      }
      const events = url.pathname.match(/^\/runs\/([^/]+)\/events$/);
      if (req.method === 'GET' && events) {
        const after = Number(url.searchParams.get('after') ?? 0);
        if (!Number.isInteger(after) || after < 0) return json(res, 400, { error: 'after must be a non-negative integer' });
        return streamEvents(res, decodeURIComponent(events[1]), after);
      }
      return json(res, 404, { error: 'not found' });
    } catch (error) {
      return json(res, 500, { error: error.message });
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
