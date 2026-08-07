import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDirectory = join(root, 'public');
const mimeTypes = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };

function send(response, status, body, contentType = 'application/json') {
  response.writeHead(status, { 'Content-Type': `${contentType}; charset=utf-8`, 'Cache-Control': 'no-store' });
  response.end(body);
}

const port = Number(process.env.PORT ?? 3000);

createServer(async (request, response) => {
  const requestUrl = new URL(request.url, 'http://localhost');
  try {
    const relativePath = requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.slice(1);
    const filePath = normalize(join(publicDirectory, relativePath));
    if (!filePath.startsWith(publicDirectory)) throw new Error('Not found');
    const body = await readFile(filePath);
    send(response, 200, body, mimeTypes[extname(filePath)] ?? 'application/octet-stream');
  } catch (error) {
    const status = error.message === 'Not found' || error.code === 'ENOENT' ? 404 : 502;
    send(response, status, JSON.stringify({ error: error.message === 'Not found' ? 'Not found' : `Could not load CSH2 prices: ${error.message} Try again later; a prior successful result will be reused from cache.` }));
  }
}).listen(port, () => console.log(`CSH2 Belgium Backtester listening at http://localhost:${port}`));
