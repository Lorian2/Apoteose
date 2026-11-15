/**
 * Teste de ponta a ponta no Foundry de verdade: abre um navegador, entra como
 * Mestre e roda `api.selfTest()` (cria um Ator temporário, exercita o Editor,
 * o Observatório e os avisos, e apaga tudo no fim).
 *
 *   FOUNDRY_URL=http://servidor:30000 FOUNDRY_USER=NomeDoMestre FOUNDRY_PASSWORD=senha npm run smoke
 *
 * Opcionais: SMOKE_BROWSER (msedge | chrome | caminho do executável),
 * SMOKE_HEADED=1 para ver a janela. O usuário não pode estar conectado em
 * outro lugar. Use um Mestre de TESTE: a senha só passa por variável de
 * ambiente e nunca deve ser gravada no repositório.
 */
import { chromium } from 'playwright-core';

const { FOUNDRY_URL, FOUNDRY_USER, FOUNDRY_PASSWORD } = process.env;
if (!FOUNDRY_URL || !FOUNDRY_USER || !FOUNDRY_PASSWORD) {
  console.error('Defina FOUNDRY_URL, FOUNDRY_USER e FOUNDRY_PASSWORD (veja o cabeçalho de test/smoke.mjs).');
  process.exit(2);
}

const MODULE_ID = 'constelacao-da-apoteose';
const browserSpec = process.env.SMOKE_BROWSER ?? (process.platform === 'win32' ? 'msedge' : 'chrome');
const launchOptions = { headless: !process.env.SMOKE_HEADED };
if (/[\\/]/.test(browserSpec)) launchOptions.executablePath = browserSpec;
else launchOptions.channel = browserSpec;

const browser = await chromium.launch(launchOptions);
const problems = [];
let exitCode = 1;
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && text.includes(MODULE_ID)) problems.push(text);
  });
  page.on('pageerror', (error) => {
    if (String(error.stack ?? error).includes(MODULE_ID)) problems.push(String(error));
  });

  await page.goto(new URL('/join', FOUNDRY_URL).href, { waitUntil: 'load' });
  await page.locator('select[name="userid"]').selectOption({ label: FOUNDRY_USER });
  await page.locator('input[name="password"]').fill(FOUNDRY_PASSWORD);
  await page.getByRole('button', { name: /join game session/i }).click();
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 90_000 });

  const info = await page.evaluate((id) => {
    const module = game.modules.get(id);
    return { active: !!module?.active, version: module?.version, api: Object.keys(module?.api ?? {}), gm: game.user.isGM, foundry: game.version };
  }, MODULE_ID);
  console.log(`Foundry ${info.foundry} · módulo ${info.version} · ${FOUNDRY_USER} (Mestre: ${info.gm})`);
  if (!info.active || !info.api.includes('selfTest')) throw new Error('módulo inativo ou sem api.selfTest: a inicialização falhou');

  const result = await page.evaluate((id) => game.modules.get(id).api.selfTest(), MODULE_ID);
  for (const step of result.steps) {
    const mark = step.skipped ? '–' : step.ok ? '✓' : '✗';
    console.log(`  ${mark} ${step.name}${step.detail ? `  (${step.detail})` : ''}`);
  }
  for (const problem of problems) console.log(`  ! console: ${problem.slice(0, 300)}`);

  const failed = result.steps.filter((step) => !step.ok).length + (problems.length ? 1 : 0);
  const skipped = result.steps.filter((step) => step.skipped).length;
  console.log(failed ? `\nFALHOU: ${failed} problema(s)` : `\nOK: ${result.steps.length} etapas${skipped ? `, ${skipped} pulada(s)` : ''}`);
  exitCode = failed ? 1 : 0;
} catch (error) {
  console.error(`\nFALHOU: ${error instanceof Error ? error.message : error}`);
} finally {
  await browser.close();
}
process.exit(exitCode);
