import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('./public/index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*>([\s\S]*?)<\/script>/gi)];
if (scripts.length !== 1) throw new Error(`expected one inline module script, found ${scripts.length}`);

const browserScript = scripts[0][1].replace(/^\s*import[^\n]*\n/m, '');
new Function(browserScript);
console.log('browser script parse: PASS');
