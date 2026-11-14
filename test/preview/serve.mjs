// Servidor da pré-visualização: npm run preview, depois abrir http://127.0.0.1:5178/
// PIXI 7.4.3, a mesma versão do Foundry V13/V14. Para usar o do seu servidor:
// PIXI_URL=http://<servidor>:30000/scripts/pixi.min.js npm run preview
import esbuild from 'esbuild';
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pixiUrl = process.env.PIXI_URL ?? 'https://cdn.jsdelivr.net/npm/pixi.js@7.4.3/dist/pixi.min.js';
const port = Number(process.env.PORT ?? 5178);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };

const context = await esbuild.context({
  entryPoints: [path.join(root, 'test', 'preview', 'preview.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  outfile: path.join(root, 'test', '.out', 'preview.js'),
  logLevel: 'info',
});
await context.watch();

http
  .createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    // POST /snapshot com um data URL PNG → test/.out/snapshot.png (para
    // inspecionar o canvas quando não dá para tirar print da janela).
    if (request.method === 'POST' && url.pathname === '/snapshot') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const dataUrl = Buffer.concat(chunks).toString('utf8');
      const name = (url.searchParams.get('name') ?? 'snapshot').replace(/[^\w-]/g, '');
      await writeFile(path.join(root, 'test', '.out', `${name}.png`), Buffer.from(dataUrl.split(',')[1] ?? '', 'base64'));
      response.writeHead(204).end();
      return;
    }

    const relative = url.pathname === '/' ? 'test/preview/index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(root, relative);
    if (!file.startsWith(root)) {
      response.writeHead(403).end();
      return;
    }
    try {
      let body = await readFile(file);
      if (file.endsWith('index.html')) body = Buffer.from(body.toString('utf8').replace('__PIXI_URL__', pixiUrl));
      response.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`Pré-visualização: http://127.0.0.1:${port}/`));
