import { MODULE_ID } from '../constants';
import { NebulaCanvas } from '../rendering/nebula-canvas';
import type { ConstellationService } from './constellation-service';

/**
 * Diagnóstico para rodar no console (F12) quando algo não aparece:
 *   await game.modules.get('constelacao-da-apoteose').api.diagnose()
 * Abre a Definição Mestra de cada Ator (o que também aplica a migração de
 * schema), testa o canvas fora da tela e devolve um relatório em texto.
 */
export async function diagnose(service: ConstellationService): Promise<string> {
  const lines: string[] = [];
  const module = game.modules?.get(MODULE_ID) as unknown as { version?: string } | undefined;
  lines.push(
    `Foundry ${game.version} · PIXI ${PIXI.VERSION} · módulo ${module?.version ?? '?'} · ` +
      `usuário ${game.user?.name} (GM: ${game.user?.isGM}, GM ativo: ${game.user?.isActiveGM})`,
  );

  const actors = (game.actors?.contents ?? []).filter((actor) => actor.getFlag(MODULE_ID, 'masterJournalId'));
  for (const actor of actors) {
    try {
      const definition = await service.getMasterDefinition(actor.id!);
      lines.push(`ok    ${actor.name}: ${definition.nodes.length} Aspectos, schema v${definition.schemaVersion}`);
    } catch (error) {
      console.error(`${MODULE_ID} | diagnóstico: ${actor.name}`, error);
      lines.push(`ERRO  ${actor.name}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    }
  }

  try {
    const { orphans } = await service.organizeJournals();
    lines.push(
      orphans.length
        ? `aviso diários sem Ator (guardados, nunca apagados): ${orphans.join('; ')}`
        : 'ok    diários: todos pertencem a um Ator',
    );
  } catch (error) {
    lines.push(`ERRO  diários: ${error instanceof Error ? error.message : String(error)}`);
  }

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:400px;height:300px;';
  document.body.appendChild(host);
  try {
    const canvas = new NebulaCanvas(host, {}, { editable: true });
    canvas.render(
      [{ id: 'teste', name: 'Teste', position: { x: 0, y: 0 }, rarityId: 'r', revealed: true, status: 'unlocked' }],
      [],
      [{ id: 'r', label: 'r', color: '#c9b6e4', order: 0 }],
    );
    canvas.renderNow(16);
    canvas.destroy();
    lines.push('ok    canvas: criado e desenhado');
  } catch (error) {
    console.error(`${MODULE_ID} | diagnóstico: canvas`, error);
    lines.push(`ERRO  canvas: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
  } finally {
    host.remove();
  }

  const report = lines.join('\n');
  console.log(`${MODULE_ID} | diagnóstico\n${report}`);
  return report;
}
