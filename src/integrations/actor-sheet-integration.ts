import { ObservatoryApplication } from '../applications/observatory-application';
import { ConstellationService } from '../services/constellation-service';
import { ConstellationError } from '../errors';

const service = new ConstellationService();

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
      console.error('🌟 [Observatory] Falha ao abrir:', error);
      ui.notifications?.error('Não foi possível abrir a Constelação da Apoteose.');
    }
  }
}

/**
 * Integração com fichas de Ator — adiciona botão "Ver Constelação" na barra
 * de ferramentas de qualquer Ator que tenha uma constelação.
 */
export function setupActorSheetIntegration(): void {
  console.log('🌟 [Setup] Iniciando integração com MutationObserver...');

  const processedApps = new Set<HTMLElement>();
  let elementCounter = 0;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;

      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;

        // Debug: mostra TODOS os elementos com classe "app"
        if (node.classList.contains('app')) {
          elementCounter++;
          console.log(`🌟 [Observer #${elementCounter}] Novo .app detectado:`, {
            classes: node.className,
            hasSheetBody: !!node.querySelector('.sheet-body'),
            hasActorSheet: !!node.querySelector('.actor-sheet'),
            isActorSheet: node.classList.contains('actor-sheet'),
            dataAttrs: {
              actorId: (node as any).dataset?.actorId,
              documentId: (node as any).dataset?.documentId,
              objectId: (node as any).dataset?.objectId,
            },
          });
          tryInjectButton(node);
        }

        // Também procura dentro de filhos
        const apps = node.querySelectorAll('.app');
        for (const app of apps) {
          if (app instanceof HTMLElement) {
            tryInjectButton(app);
          }
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  console.log('🌟 [Setup] MutationObserver ativado');

  function tryInjectButton(element: HTMLElement): void {
    // Já foi processada?
    if (processedApps.has(element)) {
      return;
    }
    processedApps.add(element);

    console.log('🌟 [Inject] Verificando elemento:', element.className);

    // Verifica se é ficha de ator procurando por indicadores
    const hasSheetBody = element.querySelector('.sheet-body');
    const hasActorSheet = element.querySelector('.actor-sheet') || element.classList.contains('actor-sheet');
    const hasCharacterSheet = element.classList.contains('character-sheet') || element.querySelector('[data-actor-id]');
    
    // Também verifica pelo nome da classe
    const classString = element.className.toLowerCase();
    const isLikelyActorSheet = classString.includes('sheet') || classString.includes('character') || classString.includes('npc');

    if (!hasSheetBody && !hasActorSheet && !hasCharacterSheet && !isLikelyActorSheet) {
      console.log('🌟 [Inject] Não parece ser ficha de ator, pulando');
      return;
    }

    console.log('🌟 [Inject] ✓ Parece ser ficha de ator!');

    // Já tem o botão?
    if (element.querySelector('.constelacao-observatory-button')) {
      console.log('🌟 [Inject] Botão já existe');
      return;
    }

    // Procura pelo actorId em vários places
    let actorId = (element as any).dataset?.actorId || 
                  (element as any).dataset?.documentId ||
                  (element as any).dataset?.objectId;

    console.log('🌟 [Inject] ActorID encontrado nos data attrs:', actorId);

    // Se não achou, procura em ui.windows
    if (!actorId) {
      console.log('🌟 [Inject] Procurando em ui.windows...');
      for (const appKey of Object.keys(ui.windows || {})) {
        const app = (ui.windows as any)[appKey];
        if (app?.element?.[0] === element || app?.element === element) {
          actorId = app?.actor?.id;
          console.log('🌟 [Inject] ActorID encontrado via ui.windows:', actorId);
          break;
        }
      }
    }

    // Última tentativa: procura por um atributo [data-appid]
    if (!actorId) {
      const appId = element.getAttribute('data-appid');
      if (appId) {
        console.log('🌟 [Inject] Encontrado data-appid:', appId);
        // Tenta achar a app pelo appId
        for (const app of Object.values(ui.windows || {})) {
          if ((app as any).appId === appId) {
            actorId = (app as any)?.actor?.id;
            console.log('🌟 [Inject] ActorID encontrado via appId:', actorId);
            break;
          }
        }
      }
    }

    if (!actorId) {
      console.warn('🌟 [Inject] Não consegui encontrar actorId');
      return;
    }

    console.log('🌟 [Inject] Injetando botão com actorId:', actorId);

    // Tenta injetar em vários pontos
    const possibleSelectors = [
      '.sheet-tabs',
      '.tabs',
      '.sheet-header',
      '.window-header',
      'nav',
    ];

    let injected = false;

    for (const selector of possibleSelectors) {
      const targetElement = element.querySelector(selector);
      if (targetElement) {
        console.log(`🌟 [Inject] Encontrado seletor: ${selector}`);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'constelacao-observatory-button';
        button.innerHTML = '🌟 Ver Constelação';
        button.title = 'Abrir minha constelação';

        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          console.log('🌟 [Button] Observatory clicado para:', actorId);
          void openObservatory(actorId);
        });

        targetElement.parentElement?.insertBefore(button, targetElement.nextSibling);
        console.log(`🌟 [Inject] ✓✓✓ Botão injetado após ${selector}`);
        injected = true;
        break;
      }
    }

    if (!injected) {
      console.log('🌟 [Inject] Nenhum seletor padrão encontrado, colocando no topo');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'constelacao-observatory-button';
      button.innerHTML = '🌟 Ver Constelação';

      button.addEventListener('click', (event) => {
        event.preventDefault();
        console.log('🌟 [Button] Observatory clicado (top) para:', actorId);
        void openObservatory(actorId);
      });

      element.insertBefore(button, element.firstChild);
      console.log('🌟 [Inject] ✓✓✓ Botão injetado no topo');
    }
  }
}
