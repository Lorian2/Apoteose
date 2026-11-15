import { MODULE_ID } from '../constants';
import { EditorApplication } from '../applications/editor-application';
import { ObservatoryApplication } from '../applications/observatory-application';
import type { ConstellationService } from './constellation-service';
import { showAnnouncements } from './announcements';
import { openConstellation } from '../hooks/register-hooks';

export interface SelfTestStep {
  name: string;
  ok: boolean;
  /** Etapa que não pôde ser verificada neste ambiente (conta como ok, mas aparece no relatório). */
  skipped?: boolean;
  detail?: string;
}

export interface SelfTestResult {
  ok: boolean;
  steps: SelfTestStep[];
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** O PIXI só renderiza e trata cliques quando o navegador desenha quadros; com a janela oculta isso não acontece. */
function pagePaintsFrames(): Promise<boolean> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve(true));
    setTimeout(() => resolve(false), 800);
  });
}

/**
 * Teste de ponta a ponta DENTRO do Foundry, para rodar como Mestre depois de
 * cada atualização (`npm run smoke` faz isso por um navegador; também dá para
 * chamar no console: `await game.modules.get('constelacao-da-apoteose').api.selfTest()`).
 *
 * Cria um Ator temporário "[selftest]", passa por criar/ligar/desbloquear,
 * abre o Editor e o Observatório, simula o clique em "Criar" no canvas e
 * mostra um aviso de conquista. No fim apaga o Ator e o diário que o teste
 * criou, mesmo se alguma etapa falhar. Nada dos seus Atores é tocado.
 */
export async function selfTest(service: ConstellationService): Promise<SelfTestResult> {
  const steps: SelfTestStep[] = [];
  const check = (name: string, ok: boolean, detail?: string) => {
    steps.push({ name, ok, detail });
    if (!ok) console.error(`${MODULE_ID} | selfTest: falhou em "${name}"`, detail ?? '');
  };
  const step = async (name: string, run: () => Promise<string | void> | string | void) => {
    try {
      check(name, true, (await run()) || undefined);
    } catch (error) {
      check(name, false, error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    }
  };
  const expect = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message);
  };

  if (!game.user?.isGM) {
    check('é Mestre', false, 'o teste precisa de um usuário Mestre');
    return { ok: false, steps };
  }

  let actor: Actor | undefined;
  let actorId = '';
  let journalId: string | undefined;
  const scratchJournals: JournalEntry[] = [];
  const scratchFolders: Folder[] = [];
  // Pastas do módulo que não existiam antes do teste: se ficarem vazias, saem junto.
  const hadFolder = (role: 'root' | 'orphans') =>
    !!game.folders?.find((folder) => folder.type === 'JournalEntry' && folder.getFlag(MODULE_ID, 'role') === role);
  const hadOrphans = hadFolder('orphans');
  try {
    await step('cria Ator temporário', async () => {
      // A lista de tipos varia por sistema (character, npc…): usa o primeiro que existir.
      const types = (game.system as unknown as { documentTypes?: { Actor?: string[] | Record<string, unknown> } })
        .documentTypes?.Actor;
      const type = (Array.isArray(types) ? types[0] : Object.keys(types ?? {})[0]) ?? 'base';
      actor = (await Actor.create({ name: '[selftest] Apoteose', type } as never)) as Actor;
      expect(actor?.id, 'Actor.create não devolveu um Ator');
      actorId = actor.id!;
      return `tipo ${type}`;
    });
    if (!actorId) return { ok: false, steps };

    let definition = await service.getMasterDefinition(actorId).catch(() => undefined);
    await step('abre a Definição Mestra (cria diário e pasta)', async () => {
      expect(definition, 'getMasterDefinition falhou');
      journalId = service.getMasterJournalId(actorId);
      const journal = journalId ? game.journal?.get(journalId) : undefined;
      expect(journal, 'diário oculto não foi criado');
      expect(journal!.folder, 'diário nasceu fora da pasta do módulo');
      expect(journal!.folder!.getFlag(MODULE_ID, 'role') === 'root', 'pasta sem o marcador do módulo');
      expect(journal!.ownership.default === CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE, 'diário visível para jogadores');
      return `pasta "${journal!.folder!.name}"`;
    });
    if (!definition) return { ok: false, steps };

    let nodeId = '';
    await step('cria e liga um Aspecto', async () => {
      const node = await service.createNode(actorId, { x: 120, y: -80 }, { name: 'Estrela de teste', visibility: 'revealed' });
      nodeId = node.id;
      await service.connectNodes(actorId, definition!.initialNodeId, nodeId);
      definition = await service.getMasterDefinition(actorId);
      expect(definition.nodes.length === 2 && definition.connections.length === 1, 'nó ou caminho não gravados');
    });

    await step('desbloquear gasta Ponto e registra na Linha do Tempo', async () => {
      await service.grantPoint(actorId);
      await service.unlockNode(actorId, nodeId);
      definition = await service.getMasterDefinition(actorId);
      expect(definition.unspentPoints === 0, `pontos: ${definition.unspentPoints}`);
      const entry = definition.history.at(-1);
      expect(entry?.kind === 'unlock' && entry.nodeId === nodeId && !!entry.date, 'sem registro automático');
      return `data "${entry!.date}"`;
    });

    await step('o jogador recebe o Estado com a situação calculada', async () => {
      const state = await service.getPlayerState(actorId);
      expect(state.nodes.find((n) => n.id === nodeId)?.status === 'unlocked', 'status não é "unlocked"');
      expect(!('exclusions' in state), 'exclusões vazaram para o jogador');
    });

    await step('organizar diários: solto vai para a pasta, órfão para "Sem Ator"', async () => {
      // Só os diários criados aqui são tocados; os reais do mundo ficam como estão.
      const make = (name: string, forActorId: string) =>
        JournalEntry.create({
          name,
          ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
          flags: { [MODULE_ID]: { masterDefinition: { ...definition!, actorId: forActorId } } },
        } as never) as Promise<JournalEntry>;
      const loose = await make('[selftest] solto', actorId);
      const orphan = await make('[selftest] órfão', 'ator-que-nao-existe');
      scratchJournals.push(loose, orphan);
      expect(!loose.folder && !orphan.folder, 'os diários de teste já nasceram em pasta');

      const result = await service.organizeJournals([loose, orphan]);
      expect(result.moved === 2, `moveu ${result.moved} diário(s), esperado 2`);
      expect(loose.folder?.getFlag(MODULE_ID, 'role') === 'root', 'o diário solto não foi para a pasta do módulo');
      const orphanFolder = orphan.folder;
      expect(orphanFolder?.getFlag(MODULE_ID, 'role') === 'orphans', 'o diário órfão não foi para "Sem Ator"');
      expect(orphanFolder?.folder?.getFlag(MODULE_ID, 'role') === 'root', '"Sem Ator" não está dentro da pasta do módulo');
      expect(result.orphans.length === 1, 'o órfão não foi reportado');

      // um diário que o Mestre já guardou em outra pasta não é mexido
      const mine = await Folder.create({ name: '[selftest] minha pasta', type: 'JournalEntry' } as never);
      scratchFolders.push(mine as Folder);
      await loose.update({ folder: mine!.id });
      const again = await service.organizeJournals([loose]);
      expect(again.moved === 0 && loose.folder?.id === mine!.id, 'um diário em pasta própria foi movido');
    });

    await step('Editor abre e monta o canvas', async () => {
      const app = new EditorApplication({ actorId });
      await app.render({ force: true });
      await wait(1500);
      const canvas = app.element?.querySelector('[data-canvas-container] canvas');
      expect(canvas, 'sem <canvas> na janela do Editor');
      expect(app.element.querySelector('[data-panel-form], .constelacao-overview'), 'painel vazio');

      if (!(await pagePaintsFrames())) {
        steps.push({ name: 'clique em "Criar" grava o Aspecto', ok: true, skipped: true, detail: 'a página não está sendo desenhada (janela oculta): o PIXI não processa cliques' });
        await app.close();
        return 'canvas montado (clique não testado)';
      }
      // simula o modo "Criar" + clique no vazio, como a pessoa faria
      (app.element.querySelector('[data-action=setMode][data-mode=create]') as HTMLElement | null)?.click();
      await wait(300);
      const box = (canvas as HTMLCanvasElement).getBoundingClientRect();
      const point = { bubbles: true, clientX: box.left + 40, clientY: box.top + 40, pointerId: 1, pointerType: 'mouse', button: 0, isPrimary: true };
      canvas!.dispatchEvent(new PointerEvent('pointerdown', { ...point, buttons: 1 }));
      canvas!.dispatchEvent(new PointerEvent('pointerup', { ...point, buttons: 0 }));
      await wait(1500);
      const after = await service.getMasterDefinition(actorId);
      expect(after.nodes.length === 3, `o clique em "Criar" não criou o Aspecto (${after.nodes.length} nós)`);
      await app.close();
      return 'clique em "Criar" gravou o Aspecto';
    });

    await step('reabrir um Editor já aberto não destrói o canvas', async () => {
      const app = new EditorApplication({ actorId });
      await app.render({ force: true });
      await wait(800);
      const before = app.element.querySelector('[data-canvas-container] canvas');
      openConstellation(actorId); // o mesmo que clicar na ★ da ficha
      await wait(800);
      const after = app.element.querySelector('[data-canvas-container] canvas');
      expect(after && document.body.contains(after), 'o canvas sumiu depois de reabrir');
      expect(before === after, 'o canvas foi recriado sem necessidade');
      await app.close();
    });

    await step('Observatório abre e monta o canvas', async () => {
      const app = new ObservatoryApplication(actorId);
      await app.render({ force: true });
      await wait(1200);
      expect(app.element?.querySelector('[data-canvas-container] canvas'), 'sem <canvas> no Observatório');
      await app.close();
    });

    await step('aviso de conquista aparece', async () => {
      const state = await service.getPlayerState(actorId);
      const node = state.nodes.find((n) => n.id === nodeId)!;
      showAnnouncements(actor!, state, { unlocked: [node], revealed: [] });
      const toast = document.querySelector('#constelacao-announcements .constelacao-toast');
      expect(toast, 'cartão não apareceu');
      expect(toast!.textContent?.includes('Estrela de teste'), 'cartão sem o nome do Aspecto');
      document.getElementById('constelacao-announcements')?.remove();
    });

    await step('desfazer o desbloqueio devolve o Ponto e apaga o registro', async () => {
      await service.lockNode(actorId, nodeId);
      definition = await service.getMasterDefinition(actorId);
      expect(definition.unspentPoints === 1, `pontos: ${definition.unspentPoints}`);
      expect(!definition.history.some((e) => e.kind === 'unlock'), 'registro automático ficou');
    });
  } finally {
    await step('limpa o que o teste criou', async () => {
      for (const id of [`constelacao-apoteose-editor-${actorId}`, `constelacao-apoteose-observatory-${actorId}`]) {
        await foundry.applications.instances.get(id)?.close();
      }
      document.getElementById('constelacao-announcements')?.remove();
      if (journalId) await game.journal?.get(journalId)?.delete();
      for (const journal of scratchJournals) await game.journal?.get(journal.id!)?.delete();
      for (const folder of scratchFolders) await game.folders?.get(folder.id!)?.delete();
      if (!hadOrphans) {
        const orphans = game.folders?.find((folder) => folder.type === 'JournalEntry' && folder.getFlag(MODULE_ID, 'role') === 'orphans');
        if (orphans && !orphans.contents.length) await orphans.delete();
      }
      await actor?.delete();
      expect(!game.actors?.get(actorId), 'o Ator temporário continua no mundo');
    });
  }

  return { ok: steps.every((entry) => entry.ok), steps };
}
