import { MODULE_ID } from './constants';
import { openConstellation, openObservatory, registerHooks } from './hooks/register-hooks';
import { registerSoundSettings } from './services/sound-settings';
import { registerDisplaySettings } from './services/display-settings';
import { ConstellationService } from './services/constellation-service';
import { diagnose } from './services/diagnostics';

const service = new ConstellationService();

/** Cada etapa do init roda isolada: uma falha não pode derrubar as outras. */
function step(name: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    console.error(`${MODULE_ID} | Falha ao inicializar (${name}):`, error);
  }
}

Hooks.once('init', () => {
  step('configurações de som', registerSoundSettings);
  step('configurações de exibição', registerDisplaySettings);
  step('hooks e botões', registerHooks);

  // API pública (API Interna, seção 8): o subconjunto seguro para macros e
  // outros módulos. Todas as escritas exigem Mestre.
  const module = game.modules?.get(MODULE_ID) as unknown as { api: Record<string, unknown> } | undefined;
  if (module) {
    module.api = {
      grantPoint: service.grantPoint.bind(service),
      revokePoint: service.revokePoint.bind(service),
      unlockNode: service.unlockNode.bind(service),
      revealNode: service.revealNode.bind(service),
      getPlayerState: service.getPlayerState.bind(service),
      /** Mestre: Editor; jogador dono: Observatório. */
      open: openConstellation,
      /** Visão do jogador (o Mestre também pode usar, para conferir o que o jogador vê). */
      openObservatory,
      /** Relatório para o console quando algo não aparece (veja services/diagnostics.ts). */
      diagnose: () => diagnose(service),
      /** Acesso completo ao serviço — não faz parte do contrato estável. */
      _service: service,
    };
  }
});
