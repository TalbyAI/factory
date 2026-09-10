import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8' };

const server = createServer(async (request, response) => {
  const pathname = request.url === '/healthz' ? null : request.url === '/' ? '/index.html' : request.url;
  if (request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
    return;
  }
  if (!pathname || pathname.includes('..')) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  try {
    const body = await readFile(join(root, pathname));
    response.writeHead(200, { 'content-type': types[extname(pathname)] ?? 'text/plain; charset=utf-8' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});

server.listen(4316, '127.0.0.1', () => {
  console.log('Factory Operator prototype: http://127.0.0.1:4316');
});
