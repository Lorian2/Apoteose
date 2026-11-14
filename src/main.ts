import { MODULE_ID } from './constants';
import { EditorApplication } from './applications/editor-application';
import { ObservatoryApplication } from './applications/observatory-application';
import { registerHooks } from './hooks/register-hooks';
import { registerGMRelay } from './services/gm-relay';
import { registerSoundSettings } from './services/sound-settings';
import { ConstellationService } from './services/constellation-service';

/**
 * Segunda etapa funcional: Camada de Dados + Camada de Domínio/Serviço
 * completas por baixo dos panos. Ainda não existe nenhuma interface — só a
 * API pública (API Interna, seção 8), testável pelo console do navegador.
 */

const service = new ConstellationService();

Hooks.once('init', () => {
  const title = game.i18n?.localize('CONSTELACAO_APOTEOSE.ModuleTitle') ?? 'Constelação da Apoteose';
  console.log(`${MODULE_ID} | Inicializando ${title}`);

  registerHooks();
  registerGMRelay(service);
  registerSoundSettings();

  // API pública curada (API Interna, seção 8) — o subconjunto de métodos
  // considerados seguros para uso por macros e outros módulos.
  const module = game.modules?.get(MODULE_ID);
  if (module) {
    (
      module as unknown as {
        api: {
          grantPoint: ConstellationService['grantPoint'];
          revokePoint: ConstellationService['revokePoint'];
          unlockNode: ConstellationService['unlockNode'];
          revealNode: ConstellationService['revealNode'];
          getPlayerState: ConstellationService['getPlayerState'];
          _service: ConstellationService;
          _openEditor: (actorId: string) => void;
          _openObservatory: (actorId: string) => void;
        };
      }
    ).api = {
      grantPoint: service.grantPoint.bind(service),
      revokePoint: service.revokePoint.bind(service),
      unlockNode: service.unlockNode.bind(service),
      revealNode: service.revealNode.bind(service),
      getPlayerState: service.getPlayerState.bind(service),
      // Acesso completo ao serviço para teste manual durante o
      // desenvolvimento — não faz parte do contrato público estável.
      _service: service,
      // Idem: abre o Editor sem depender da integração com a ficha do
      // Ator, que ainda não foi implementada (ver nota no chat).
      _openEditor: (actorId: string) => {
        new EditorApplication({ actorId }).render(true);
      },
      // Abre a visão de jogador (Observatory) — pode ser chamada por jogador não-GM
      _openObservatory: (actorId: string) => {
        new ObservatoryApplication(actorId).render(true);
      },
    };
  }
});

Hooks.once('ready', () => {
  const title = game.i18n?.localize('CONSTELACAO_APOTEOSE.ModuleTitle') ?? 'Constelação da Apoteose';
  console.log(`${MODULE_ID} | ${title} pronto`);

  if (game.user?.isGM) {
    const message = game.i18n?.localize('CONSTELACAO_APOTEOSE.LoadedNotification') ?? 'Módulo carregado com sucesso.';
    ui.notifications?.info(message);
  }
});
