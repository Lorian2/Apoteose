import { MODULE_ID } from '../constants';
import { EditorApplication } from '../applications/editor-application';
import { ObservatoryApplication } from '../applications/observatory-application';
import { ConstellationService } from '../services/constellation-service';
import { ConstellationError } from '../errors';

const service = new ConstellationService();

/**
 * Integração com o ciclo de vida do Foundry (Arquitetura de Software, seção
 * 6 · Fluxo de Navegação, seção 1).
 *
 * O botão na ficha usa o hook genérico `renderApplicationV2` — ele dispara
 * para QUALQUER Application baseada em ApplicationV2, inclusive fichas de
 * Ator de sistemas de terceiros, porque o Foundry dispara esse hook para
 * cada classe na cadeia de herança, não só para o nome da classe final
 * (é o mesmo motivo por trás do `getHeaderControlsApplicationV2` mencionado
 * no TDD). Isso é o que garante compatibilidade *system agnostic* real: o
 * módulo nunca precisa saber o nome da classe de ficha de cada sistema.
 *
 * Diferente do mecanismo de "header controls" do próprio Foundry (que exige
 * que a classe da ficha reconheça o nome da ação clicada), o botão é criado
 * e ouvido diretamente aqui — funciona não importa qual sistema estiver
 * rodando.
 *
 * O mesmo botão roteia por permissão: Mestre abre o EditorApplication;
 * jogador dono do Ator abre o ObservatoryApplication (leitura). Quem não é
 * Mestre nem dono do Ator não vê botão nenhum.
 */
export function registerHooks(): void {
  Hooks.on('renderApplicationV2', (application: unknown) => {
    addConstellationHeaderButton(application);
  });
}

function addConstellationHeaderButton(application: unknown): void {
  const actor = (application as { document?: unknown }).document;
  if (!(actor instanceof Actor) || !actor.id) {
    return;
  }
  const actorId = actor.id;
  const isGM = !!game.user?.isGM;

  if (!isGM && !actor.isOwner) {
    return; // não é Mestre nem dono do Ator — sem botão
  }

  const element = (application as { element?: HTMLElement }).element;
  const header = element?.querySelector<HTMLElement>('.window-header');
  if (!header || header.querySelector('[data-constelacao-apoteose-button]')) {
    return; // sem cabeçalho, ou o botão já foi inserido num render anterior
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.classList.add('header-control', 'icon', 'fa-solid', 'fa-star');
  button.dataset.constelacaoApoteoseButton = 'true';

  if (isGM) {
    button.title = game.i18n?.localize('CONSTELACAO_APOTEOSE.OpenButtonLabel') ?? 'Constelação da Apoteose';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      new EditorApplication({ actorId }).render(true);
    });
  } else {
    button.title =
      game.i18n?.localize('CONSTELACAO_APOTEOSE.OpenObservatoryButtonLabel') ?? 'Minha Constelação';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void openObservatory(actorId);
    });
  }

  header.appendChild(button);
}

/**
 * Checa se a constelação do Ator já foi inicializada pelo Mestre antes de
 * abrir o Observatório — evita que o jogador esbarre num erro de permissão
 * do Foundry (JournalEntry oculto) quando é o primeiro a tentar abrir.
 */
async function openObservatory(actorId: string): Promise<void> {
  try {
    await service.getPlayerState(actorId);
    new ObservatoryApplication(actorId).render(true);
  } catch (error) {
    if (error instanceof ConstellationError && error.code === 'NOT_INITIALIZED') {
      ui.notifications?.warn('Sua constelação ainda não foi criada pelo Mestre. Peça pra ele abrir sua ficha primeiro.');
    } else {
      console.error(`${MODULE_ID} | Falha ao abrir o Observatório:`, error);
      ui.notifications?.error('Não foi possível abrir a Constelação da Apoteose.');
    }
  }
}
