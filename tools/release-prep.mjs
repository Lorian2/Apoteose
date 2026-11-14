/**
 * Prepara uma versão para lançamento:
 *  - grava versão, manifesto, download e links do repositório no module.json;
 *  - extrai do CHANGELOG.md as notas da versão para release-notes.md.
 *
 * Uso: node tools/release-prep.mjs 0.3.0 [owner/repo]
 * Usado pela GitHub Action de release (a partir da tag) e pelo script local de lançamento.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [version, repo = 'Lorian2/Apoteose'] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('Uso: node tools/release-prep.mjs <versão X.Y.Z> [owner/repo]');
  process.exit(1);
}

const base = `https://github.com/${repo}`;
const manifestPath = path.join(root, 'module.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
Object.assign(manifest, {
  version,
  url: base,
  manifest: `${base}/releases/latest/download/module.json`,
  download: `${base}/releases/download/v${version}/constelacao-da-apoteose.zip`,
  readme: `${base}/blob/main/README.md`,
  changelog: `${base}/blob/main/CHANGELOG.md`,
  bugs: `${base}/issues`,
});
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`module.json → v${version}`);

const packagePath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
if (pkg.version !== version) {
  pkg.version = version;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`package.json → v${version}`);
}

// Notas da versão a partir do CHANGELOG ("## [X.Y.Z] ..." até o próximo "## [")
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const start = changelog.indexOf(`## [${version}]`);
let notes = '';
if (start >= 0) {
  const rest = changelog.slice(start);
  const next = rest.indexOf('\n## [', 1);
  notes = (next >= 0 ? rest.slice(0, next) : rest).split('\n').slice(1).join('\n').trim();
}
if (!notes) notes = `Versão ${version}.`;
notes += `\n\n**Instalação:** no Foundry, em *Instalar Módulo*, cole o manifesto:\n\`${manifest.manifest}\``;
fs.writeFileSync(path.join(root, 'release-notes.md'), `${notes}\n`);
console.log('release-notes.md gerado');
