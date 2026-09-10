import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { config } from './config.mjs';
import { json } from './protocol.mjs';

const children = new Map();

function start(name, file) {
  const child = spawn(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], { stdio: 'inherit' });
  children.set(name, child);
  child.on('exit', () => {
    if (children.get(name) === child) children.delete(name);
  });
  return child;
}

async function restart(name, file) {
  const child = children.get(name);
  if (child?.exitCode === null) {
    await new Promise(resolve => {
      child.once('exit', resolve);
      child.kill();
    });
  }
  start(name, file);
}

const controls = {
  bff: './bff.mjs',
  mastra: './mastra-server.mjs',
};

for (const [name, file] of Object.entries(controls)) start(name, file);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  res.setHeader('access-control-allow-origin', config.bffUrl);
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.end();
  const match = url.pathname.match(/^\/admin\/restart\/(bff|mastra)$/);
  if (req.method !== 'POST' || !match) return json(res, 404, { error: 'not found' });
  await restart(match[1], controls[match[1]]);
  return json(res, 202, { restarted: match[1] });
});

server.listen(config.supervisorPort, '127.0.0.1');
process.once('SIGINT', () => {
  server.close();
  for (const child of children.values()) child.kill();
});
