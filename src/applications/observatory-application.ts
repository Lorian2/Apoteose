import { MODULE_ID } from '../constants';
import { ConstellationError } from '../errors';
import { ConstellationService } from '../services/constellation-service';
import { requestUnlockNode } from '../services/gm-relay';
import { NebulaCanvas } from '../rendering/nebula-canvas';
import { computeBlockedNodeIds } from '../utils/exclusion';
import { computePrerequisiteLockedNodeIds } from '../utils/prerequisites';
import { playMediaSound } from '../utils/sound';
import { BackgroundMusicPlayer } from '../rendering/background-music';
import type { PlayerConstellationState } from '../types/constellation';

/**
 * Observatório — visão do jogador sobre sua constelação (leitura apenas, sem edição).
 *
 * Mostra apenas os Aspectos já revelados (visibility === 'revealed') e as conexões
 * entre eles. Sem ferramentas de edição, sem Pontos da Apoteose, sem média picker.
 *
 * Abre quando um jogador clica no seu Ator pra ver a progressão narrativa.
 *
 * IMPORTANTE: precisa ser ApplicationV2 (igual ao EditorApplication), nunca
 * FormApplication (API v1) — v1 não chama _prepareContext/_onFirstRender nem
 * entende render({ parts }), então o template renderizava sem dados e sem
 * montar a canvas: era exatamente o bug de "janela com só texto, sem
 * interface nem botões" relatado pelo jogador.
 */
export class ObservatoryApplication extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static override DEFAULT_OPTIONS = {
    classes: ['constelacao-apoteose', 'observatory-application'],
    window: {
      title: 'CONSTELACAO_APOTEOSE.ObservatoryTitle',
      icon: 'fa-solid fa-star',
      resizable: true,
    },
    position: {
      width: 900,
      height: 600,
    },
    actions: {
      unlockNode(this: ObservatoryApplication) {
        void this.#handleUnlockNode();
      },
      recenterView(this: ObservatoryApplication) {
        this.#canvas?.recenterView();
      },
    },
  };

  static override PARTS = {
    canvas: {
      template: `modules/${MODULE_ID}/templates/observatory-canvas.hbs`,
      classes: ['constelacao-canvas-placeholder'],
    },
    panel: {
      template: `modules/${MODULE_ID}/templates/observatory-panel.hbs`,
      classes: ['constelacao-panel'],
    },
  };

  readonly #actorId: string;
  readonly #service: ConstellationService;
  readonly #music = new BackgroundMusicPlayer();
  #canvas: NebulaCanvas | undefined;
  #lastPlayerState: PlayerConstellationState | undefined;
  #selectedNodeId: string | null = null;
  #unlockInFlight = false;
  #actorUpdateHook: number | undefined;

  constructor(actorId: string) {
    super({ id: `constelacao-apoteose-observatory-${actorId}` });
    this.#actorId = actorId;
    this.#service = new ConstellationService();
  }

  protected override async _prepareContext(): Promise<object> {
    const actor = game.actors?.get(this.#actorId);
    const playerState = await this.#service.getPlayerState(this.#actorId);
    this.#lastPlayerState = playerState;
    void this.#music.setTrack(playerState.backgroundMusic);

    const selectedNode = this.#selectedNodeId
      ? playerState.nodes.find((node) => node.id === this.#selectedNodeId)
      : undefined;

    const blockedIds = computeBlockedNodeIds(playerState.nodes, playerState.connections);
    const prerequisiteLockedIds = computePrerequisiteLockedNodeIds(playerState.nodes, playerState.connections);
    const selectedNodeBlocked = !!selectedNode && blockedIds.has(selectedNode.id);
    const selectedNodePrerequisiteLocked = !!selectedNode && prerequisiteLockedIds.has(selectedNode.id);

    return {
      actorName: actor?.name ?? '(Ator não encontrado)',
      nodeCount: playerState.nodes.length,
      unlockedCount: playerState.nodes.filter((node) => node.unlocked).length,
      unspentPoints: playerState.unspentPoints,
      categories: playerState.categories,
      rarities: playerState.rarities,
      history: [...playerState.history].reverse().map((entry) => ({
        ...entry,
        nodeName: playerState.nodes.find((node) => node.id === entry.nodeId)?.name ?? '',
      })),
      selectedNode: selectedNode
        ? this.#toPanelViewModel(selectedNode, selectedNodeBlocked, selectedNodePrerequisiteLocked)
        : null,
      canUnlockSelected:
        !!selectedNode &&
        !selectedNode.unlocked &&
        !selectedNodeBlocked &&
        !selectedNodePrerequisiteLocked &&
        playerState.unspentPoints > 0,
      unlockInFlight: this.#unlockInFlight,
      unlockButtonDisabled:
        this.#unlockInFlight || !selectedNode || selectedNode.unlocked || playerState.unspentPoints <= 0,
    };
  }

  protected override async _onFirstRender(context: object, options: object): Promise<void> {
    await super._onFirstRender(context, options);
    this.#mountCanvas();
    // Delegação num elemento estável: sobrevive aos re-renders parciais do
    // painel, que substituem só o conteúdo interno, não este listener
    // (mesmo padrão do EditorApplication).
    this.element.addEventListener('click', (event) => {
      const panel = (event.target as HTMLElement).closest('[data-panel-select]');
      if (panel instanceof HTMLElement && panel.dataset.nodeId) {
        this.#handleNodeSelected(panel.dataset.nodeId);
      }
    });
    // Qualquer mudança na flag playerState do Ator (ex.: o Mestre concede um
    // Ponto da Apoteose pelo Editor enquanto o jogador está com o
    // Observatório aberto) deve aparecer sem precisar reabrir a janela.
    this.#actorUpdateHook = Hooks.on('updateActor', (actor: Actor) => {
      if (actor.id !== this.#actorId) {
        return;
      }
      void this.#refreshFromExternalUpdate();
    });
  }

  protected override _onClose(options: object): void {
    if (this.#actorUpdateHook !== undefined) {
      Hooks.off('updateActor', this.#actorUpdateHook);
      this.#actorUpdateHook = undefined;
    }
    this.#canvas?.destroy();
    this.#canvas = undefined;
    this.#music.stop();
    super._onClose(options);
  }

  #mountCanvas(): void {
    const container = this.element.querySelector<HTMLElement>('[data-canvas-container]');
    if (!container) {
      return;
    }

    this.#canvas = new NebulaCanvas(container, {
      onNodeSelected: (nodeId) => this.#handleNodeSelected(nodeId),
      // Outros callbacks não usados no modo read-only:
      onNodeMoved: () => {},
      onConnectionRequested: () => {},
      onCreateRequested: () => {},
      onNodeRemoveRequested: () => {},
      onConnectionRemoveRequested: () => {},
    });

    this.#renderCanvas();
  }

  #renderCanvas(): void {
    if (!this.#canvas || !this.#lastPlayerState) {
      return;
    }

    // Mapeia PlayerVisibleNode pro formato que a canvas espera
    // (todos já estão revelados por definição, nenhum é oculto pra jogador)
    const blockedIds = computeBlockedNodeIds(this.#lastPlayerState.nodes, this.#lastPlayerState.connections);
    const prerequisiteLockedIds = computePrerequisiteLockedNodeIds(
      this.#lastPlayerState.nodes,
      this.#lastPlayerState.connections,
    );
    const renderableNodes = this.#lastPlayerState.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      color: node.color,
      icon: node.media.icon,
      rarityId: node.rarityId,
      revealed: true, // Todos os nós visíveis ao jogador são revelados
      unlocked: node.unlocked,
      blocked: blockedIds.has(node.id),
      prerequisiteLocked: prerequisiteLockedIds.has(node.id),
    }));

    this.#canvas.render(renderableNodes, this.#lastPlayerState.connections, this.#lastPlayerState.rarities);
    this.#canvas.setBackground(this.#lastPlayerState.background);
  }

  #handleNodeSelected(nodeId: string | null): void {
    this.#selectedNodeId = nodeId;
    if (nodeId) {
      const node = this.#lastPlayerState?.nodes.find((candidate) => candidate.id === nodeId);
      playMediaSound(node?.media.soundSelect);
    }
    void this.render({ parts: ['panel'] });
  }

  /** Reage a updateActor vindo de outro client (ex.: Mestre concedeu um ponto). */
  async #refreshFromExternalUpdate(): Promise<void> {
    await this.#applyNewPlayerState(await this.#service.getPlayerState(this.#actorId));
  }

  /**
   * Único ponto que troca `#lastPlayerState` por um novo estado — compara
   * com o anterior pra tocar soundReveal (nó que passou a existir no array,
   * ou seja, acabou de ser revelado) e soundUnlock (nó que já existia mas
   * virou `unlocked`), não importa se quem causou a mudança foi este client
   * (pedido de desbloqueio) ou outro (Mestre revelando/desbloqueando pelo
   * Editor enquanto o jogador está com o Observatório aberto).
   */
  async #applyNewPlayerState(nextState: PlayerConstellationState): Promise<void> {
    const previousById = new Map((this.#lastPlayerState?.nodes ?? []).map((node) => [node.id, node]));

    for (const node of nextState.nodes) {
      const previous = previousById.get(node.id);
      if (!previous) {
        playMediaSound(node.media.soundReveal);
      } else if (!previous.unlocked && node.unlocked) {
        playMediaSound(node.media.soundUnlock);
      }
    }

    this.#lastPlayerState = nextState;
    this.#renderCanvas();
    void this.render({ parts: ['panel'] });
  }

  /**
   * Clique no botão "Desbloquear" do painel. O jogador nunca escreve a
   * Definição Mestra diretamente (JournalEntry oculto, ownership None) —
   * o pedido passa pelo relé de socket até o Mestre ativo, que executa o
   * desbloqueio de verdade e devolve sucesso ou um erro previsível (ex.:
   * sem Pontos da Apoteose disponíveis).
   */
  async #handleUnlockNode(): Promise<void> {
    const nodeId = this.#selectedNodeId;
    if (!nodeId || this.#unlockInFlight) {
      return;
    }

    this.#unlockInFlight = true;
    void this.render({ parts: ['panel'] });

    try {
      await requestUnlockNode(this.#actorId, nodeId);
      ui.notifications?.info('Aspecto desbloqueado!');
      await this.#applyNewPlayerState(await this.#service.getPlayerState(this.#actorId));
    } catch (error) {
      if (error instanceof ConstellationError) {
        ui.notifications?.warn(error.message);
      } else {
        throw error;
      }
    } finally {
      this.#unlockInFlight = false;
      void this.render({ parts: ['panel'] });
    }
  }

  #toPanelViewModel(
    node: {
      id: string;
      name: string;
      subtitle?: string;
      quote?: string;
      description?: string;
      categoryId?: string;
      rarityId: string;
      type: string;
      unlocked: boolean;
      media: { image?: string };
    },
    blocked: boolean,
    prerequisiteLocked: boolean,
  ) {
    return {
      id: node.id,
      name: node.name,
      subtitle: node.subtitle ?? '',
      quote: node.quote ?? '',
      description: node.description ?? '',
      image: node.media.image ?? '',
      categoryId: node.categoryId ?? '',
      rarityId: node.rarityId,
      type: node.type,
      unlocked: node.unlocked,
      blocked,
      prerequisiteLocked,
    };
  }
}
