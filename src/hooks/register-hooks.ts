import { MODULE_ID } from '../constants';
import { EditorApplication } from '../applications/editor-application';
import { ObservatoryApplication } from '../applications/observatory-application';
import { ConstellationService } from '../services/constellation-service';
import { ConstellationError } from '../errors';
import { onUntypedHook } from '../utils/hooks';
import { t } from '../utils/i18n';

const service = new ConstellationService();

/** Abre o Editor (Mestre) ou o Observatório (dono do Ator), trazendo a janela à frente se já estiver aberta. */
export function openConstellation(actorId: string): void {
  if (game.user?.isGM) {
    openWindow(`constelacao-apoteose-editor-${actorId}`, () => new EditorApplication({ actorId }));
  } else {
    void openObservatory(actorId);
  }
}

/** Abre o Observatório; com `nodeId`, já seleciona e centraliza aquele Aspecto. */
export async function openObservatory(actorId: string, nodeId?: string): Promise<void> {
  try {
    await service.getPlayerState(actorId);
    const app = await openWindow(
      `constelacao-apoteose-observatory-${actorId}`,
      () => new ObservatoryApplication(actorId),
    );
    if (nodeId && app instanceof ObservatoryApplication) app.showNode(nodeId);
  } catch (error) {
    if (error instanceof ConstellationError && error.code === 'NOT_INITIALIZED') {
      ui.notifications?.warn('Sua constelação ainda não foi criada. Peça ao Mestre para abri-la uma vez.');
    } else {
      console.error(`${MODULE_ID} | Falha ao abrir o Observatório:`, error);
      ui.notifications?.error('Não foi possível abrir a Constelação da Apoteose.');
    }
  }
}

async function openWindow(
  id: string,
  create: () => foundry.applications.api.ApplicationV2,
): Promise<foundry.applications.api.ApplicationV2> {
  const existing = foundry.applications.instances.get(id);
  if (existing) {
    // Não re-renderiza: refazer todas as partes substituiria o <canvas> da
    // janela. Já aberta, basta trazê-la à frente (e restaurar se minimizada).
    if (existing.minimized) await existing.maximize();
    existing.bringToFront();
    return existing;
  }
  const app = create();
  await app.render({ force: true });
  return app;
}

/**
 * Pontos de entrada:
 * - botão ★ no cabeçalho de qualquer ficha de Ator em ApplicationV2
 *   (`renderApplicationV2` dispara para toda a cadeia de classes, então
 *   funciona em qualquer sistema sem conhecer a classe da ficha);
 * - item "Constelação da Apoteose" no menu de contexto da lista de Atores.
 * Mestre abre o Editor; o dono do Ator abre o Observatório.
 */
export function registerHooks(): void {
  Hooks.on('renderApplicationV2', (application: unknown) => {
    addConstellationHeaderButton(application);
  });

  // Hook da v13+ (`get${documentName}ContextOptions`) que os tipos ainda não conhecem.
  onUntypedHook('getActorContextOptions', (_application: unknown, entries: unknown[]) => {
    const actorFrom = (target: HTMLElement) => game.actors?.get(target.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId ?? '');
    entries.push({
      label: t('CONSTELACAO_APOTEOSE.OpenButtonLabel', 'Constelação da Apoteose'),
      icon: 'fa-solid fa-star',
      visible: (target: HTMLElement) => {
        const actor = actorFrom(target);
        return !!actor && (!!game.user?.isGM || actor.isOwner);
      },
      onClick: (_event: PointerEvent, target: HTMLElement) => {
        const actor = actorFrom(target);
        if (actor?.id) openConstellation(actor.id);
      },
    });
  });

  // Estados do Jogador gravados por versões antigas são regravados pelo
  // Mestre ativo, para os jogadores receberem o formato novo sem que o
  // Mestre precise abrir cada constelação.
  Hooks.once('ready', () => {
    if (!game.user?.isActiveGM) return;
    void service
      .migrateOutdatedPlayerStates()
      .then(({ migrated, failed }) => {
        if (migrated.length) console.log(`${MODULE_ID} | Constelações atualizadas: ${migrated.join(', ')}`);
        for (const { name, error } of failed) console.error(`${MODULE_ID} | Falha ao migrar a constelação de ${name}:`, error);
        if (failed.length) {
          ui.notifications?.error(
            `Constelação da Apoteose: não foi possível atualizar ${failed.map((entry) => entry.name).join(', ')}. ` +
              'Os dados continuam salvos; veja o console (F12).',
            { permanent: true },
          );
        }
      })
      .catch((error) => console.error(`${MODULE_ID} | Falha ao migrar constelações:`, error))
      .then(() => service.organizeJournals())
      .then(({ moved }) => {
        if (moved) console.log(`${MODULE_ID} | ${moved} diário(s) oculto(s) movido(s) para a pasta do módulo.`);
      })
      .catch((error) => console.warn(`${MODULE_ID} | Não foi possível organizar os diários:`, error));
  });
}

function addConstellationHeaderButton(application: unknown): void {
  const actor = (application as { document?: unknown }).document;
  if (!(actor instanceof Actor) || !actor.id) return;
  if (!game.user?.isGM && !actor.isOwner) return;

  const element = (application as { element?: HTMLElement }).element;
  const header = element?.querySelector<HTMLElement>('.window-header');
  if (!header || header.querySelector('[data-constelacao-apoteose-button]')) return;

  const actorId = actor.id;
  const button = document.createElement('button');
  button.type = 'button';
  button.classList.add('header-control', 'icon', 'fa-solid', 'fa-star');
  button.dataset.constelacaoApoteoseButton = 'true';
  button.dataset.tooltip = game.user?.isGM
    ? t('CONSTELACAO_APOTEOSE.OpenButtonLabel', 'Constelação da Apoteose')
    : t('CONSTELACAO_APOTEOSE.OpenObservatoryButtonLabel', 'Minha Constelação');
  button.setAttribute('aria-label', button.dataset.tooltip);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openConstellation(actorId);
  });

  // Antes dos controles padrão (menu ⋮ e fechar), para ficar à vista.
  // Fichas de sistema podem reorganizar o cabeçalho: só usa a referência se
  // ela for filha direta, senão insertBefore lança erro e o botão some.
  const firstControl = header.querySelector(':scope > [data-action="toggleControls"], :scope > [data-action="close"]');
  if (firstControl) header.insertBefore(button, firstControl);
  else header.appendChild(button);
}
