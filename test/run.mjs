// Empacota test/logic.test.ts com esbuild e roda no Node, com um stub
// mínimo do que o código usa de `foundry.utils`.
import esbuild from 'esbuild';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outfile = path.join(root, 'test', '.out', 'logic.test.mjs');

globalThis.foundry = {
  utils: {
    randomID: () => randomBytes(8).toString('hex').slice(0, 16),
    deepClone: (value) => structuredClone(value),
  },
};
globalThis.Hooks = { callAll: () => true };

await esbuild.build({
  entryPoints: [path.join(root, 'test', 'logic.test.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile,
  logLevel: 'warning',
});

await import(pathToFileURL(outfile).href);
