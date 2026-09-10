import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { config } from './config.mjs';
import { json } from './protocol.mjs';

const children = new Map();
const restarts = new Map();
let shuttingDown = false;

function start(name, file) {
  if (shuttingDown) return;
  const existing = children.get(name);
  if (existing?.exitCode === null) return existing;
  const child = spawn(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], { stdio: 'inherit' });
  children.set(name, child);
  child.on('exit', () => {
    if (children.get(name) === child) children.delete(name);
  });
  return child;
}

function stop(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    if (!child.kill('SIGINT')) {
      clearTimeout(timer);
      resolve();
    }
  });
}

async function restartChild(name, file) {
  if (shuttingDown) return;
  await stop(children.get(name));
  if (shuttingDown) return;
  start(name, file);
}

function restart(name, file) {
  if (shuttingDown) return Promise.resolve();
  const pending = restarts.get(name);
  if (pending) return pending;
  const next = restartChild(name, file);
  restarts.set(name, next);
  void next.then(() => restarts.delete(name), () => restarts.delete(name));
  return next;
}

const controls = {
  bff: './bff.mjs',
  mastra: './mastra-server.mjs',
};

for (const [name, file] of Object.entries(controls)) start(name, file);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    res.setHeader('access-control-allow-origin', config.bffUrl);
    res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.end();
    const match = url.pathname.match(/^\/admin\/restart\/(bff|mastra)$/);
    if (req.method !== 'POST' || !match) return json(res, 404, { error: 'not found' });
    await restart(match[1], controls[match[1]]);
    return json(res, 202, { restarted: match[1] });
  } catch (error) {
    if (!res.headersSent) return json(res, 500, { error: error.message });
    res.destroy();
  }
});

server.listen(config.supervisorPort, '127.0.0.1');
process.once('SIGINT', () => {
  shuttingDown = true;
  server.close();
  void Promise.all([...children.values()].map(stop));
});
