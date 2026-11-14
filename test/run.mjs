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
// Imita a V14: métodos estáticos com campo privado, que lançam erro se
// chamados soltos (sem `this`) — foi o bug que derrubava o init na 0.2.0.
globalThis.Hooks = class Hooks {
  static #events = {};
  static on(name, fn) {
    (this.#events[name] ??= []).push(fn);
    return this.#events[name].length;
  }
  static callAll(name, ...args) {
    for (const fn of this.#events[name] ?? []) fn(...args);
    return true;
  }
};

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
