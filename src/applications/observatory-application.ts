import { ASPECT_TYPE_LABELS, MODULE_ID, NODE_STATUS_LABELS } from '../constants';
import { ConstellationService } from '../services/constellation-service';
import { NebulaCanvas } from '../rendering/nebula-canvas';
import { BackgroundMusicPlayer } from '../rendering/background-music';
import { computeNodeStatuses } from '../utils/node-status';
import { plainTextToHTML } from '../utils/html';
import { buildHistoryView } from '../utils/history-view';
import { playMediaSound } from '../utils/sound';
import { t } from '../utils/i18n';
import { reportFailure } from '../utils/report';
import { isSkyAnimated } from '../services/display-settings';
import type { NodeStatus, PlayerConstellationState, PlayerVisibleNode } from '../types/constellation';

const STATUS_NOTES: Record<NodeStatus, string> = {
  unlocked: 'Este Aspecto já faz parte da sua lenda.',
  available: 'Pode receber um Ponto da Apoteose. Combine com o Mestre: é ele quem marca o desbloqueio.',
  prerequisite: 'Para chegar aqui, é preciso antes desbloquear um Aspecto que leve até ele.',
  excluded: 'Este caminho se fechou: outra escolha foi feita.',
};

/**
 * Observatório: a constelação vista pelo jogador, só leitura. Recebe apenas
 * o Estado do Jogador (nós revelados, situação já calculada pelo Mestre).
 * O desbloqueio é sempre feito pelo Mestre no Editor (GDD §6–7); aqui o
 * jogador acompanha, em tempo real, as estrelas surgindo e acendendo.
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
      width: 1000,
      height: 640,
    },
    actions: {
      fitView: function (this: ObservatoryApplication) {
        this.#canvas?.fitView();
      },
      selectNode: function (this: ObservatoryApplication, _event: PointerEvent, target: HTMLElement) {
        const nodeId = target.dataset.nodeId;
        if (!nodeId) return;
        this.#canvas?.setSelectedNode(nodeId);
        this.#canvas?.focusNode(nodeId);
        this.#handleNodeSelected(nodeId);
      },
      clearSelection: function (this: ObservatoryApplication) {
        this.#canvas?.setSelectedNode(null);
        this.#handleNodeSelected(null);
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
      scrollable: [''],
    },
  };

  readonly #actorId: string;
  readonly #service = new ConstellationService();
  readonly #music = new BackgroundMusicPlayer();
  #canvas: NebulaCanvas | undefined;
  #state: PlayerConstellationState | undefined;
  #selectedNodeId: string | null = null;
  #actorUpdateHook: number | undefined;

  constructor(actorId: string) {
    super({ id: `constelacao-apoteose-observatory-${actorId}` });
    this.#actorId = actorId;
  }

  override get title(): string {
    const base = t('CONSTELACAO_APOTEOSE.ObservatoryTitle', 'Constelação');
    const name = game.actors?.get(this.#actorId)?.name;
    return name ? `${base}: ${name}` : base;
  }

  protected override async _prepareContext(): Promise<object> {
    const state = (this.#state ??= await this.#service.getPlayerState(this.#actorId));
    void this.#music.setTrack(state.backgroundMusic);
    const statuses = this.#statuses(state);
    const selected = this.#selectedNodeId ? state.nodes.find((node) => node.id === this.#selectedNodeId) : undefined;

    const available = state.nodes
      .filter((node) => statuses.get(node.id) === 'available')
      .map((node) => ({ id: node.id, name: node.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      actorName: game.actors?.get(this.#actorId)?.name ?? '(Ator não encontrado)',
      nodeCount: state.nodes.length,
      unlockedCount: state.nodes.filter((node) => node.unlocked).length,
      unspentPoints: state.unspentPoints,
      available,
      history: buildHistoryView(state.history, (id) => state.nodes.find((node) => node.id === id)?.name ?? ''),
      selectedNode: selected ? await this.#toPanelViewModel(selected, state, statuses.get(selected.id)!) : null,
    };
  }

  protected override async _onFirstRender(context: object, options: object): Promise<void> {
    await super._onFirstRender(context, options);
    try {
      this.#mountCanvas();
    } catch (error) {
      reportFailure('o canvas não pôde ser criado', error);
    }
    this.#actorUpdateHook = Hooks.on('updateActor', (actor: Actor, changes: object) => {
      if (actor.id !== this.#actorId) return;
      if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.playerState`)) return;
      void this.#refresh();
    });
  }

  /** Remonta o canvas se um render completo trocar o elemento dele (ver o Editor). */
  protected override async _onRender(context: object, options: object): Promise<void> {
    await super._onRender(context, options);
    const container = this.element.querySelector<HTMLElement>('[data-canvas-container]');
    if (!container || (this.#canvas && container.querySelector('canvas'))) return;
    this.#canvas?.destroy();
    this.#canvas = undefined;
    try {
      this.#mountCanvas();
      (this.#canvas as NebulaCanvas | undefined)?.setSelectedNode(this.#selectedNodeId);
    } catch (error) {
      reportFailure('o canvas não pôde ser recriado', error);
    }
  }

  protected override _onClose(options: object): void {
    if (this.#actorUpdateHook !== undefined) Hooks.off('updateActor', this.#actorUpdateHook);
    this.#canvas?.destroy();
    this.#canvas = undefined;
    this.#music.stop();
    super._onClose(options);
  }

  /** Seleciona e centraliza um Aspecto (usado pelo clique no aviso de conquista). */
  showNode(nodeId: string): void {
    if (!this.#state?.nodes.some((node) => node.id === nodeId)) return;
    this.#canvas?.setSelectedNode(nodeId);
    this.#canvas?.focusNode(nodeId);
    this.#handleNodeSelected(nodeId);
  }

  /** Estados gravados antes do schema v3 não trazem `status`: calcula com o que há. */
  #statuses(state: PlayerConstellationState): Map<string, NodeStatus> {
    if (state.nodes.every((node) => node.status)) {
      return new Map(state.nodes.map((node) => [node.id, node.status!]));
    }
    return computeNodeStatuses(state.nodes, state.connections);
  }

  async #toPanelViewModel(node: PlayerVisibleNode, state: PlayerConstellationState, status: NodeStatus) {
    const rarity = state.rarities.find((candidate) => candidate.id === node.rarityId);
    const category = state.categories.find((candidate) => candidate.id === node.categoryId);
    const TextEditor = foundry.applications.ux.TextEditor.implementation;
    const description = node.description?.trim()
      ? await TextEditor.enrichHTML(plainTextToHTML(node.description), {
          secrets: false,
          relativeTo: game.actors?.get(this.#actorId),
        })
      : '';

    return {
      id: node.id,
      name: node.name,
      subtitle: node.subtitle ?? '',
      quote: node.quote ?? '',
      description,
      image: node.media?.image ?? '',
      categoryLabel: category?.label ?? '',
      categoryColor: category?.color ?? '',
      rarityLabel: rarity?.label ?? '',
      rarityColor: node.color || rarity?.color || '#c9b6e4',
      typeLabel: ASPECT_TYPE_LABELS[node.type] ?? node.type,
      status,
      statusLabel: NODE_STATUS_LABELS[status],
      statusNote: STATUS_NOTES[status],
    };
  }

  #mountCanvas(): void {
    const container = this.element.querySelector<HTMLElement>('[data-canvas-container]');
    if (!container) throw new Error('área do canvas não encontrada na janela');
    this.#canvas = new NebulaCanvas(container, { onNodeSelected: (nodeId) => this.#handleNodeSelected(nodeId) }, {
      editable: false,
      animated: isSkyAnimated(),
    });
    this.#renderCanvas();
  }

  #renderCanvas(): void {
    const state = this.#state;
    if (!this.#canvas || !state) return;
    const statuses = this.#statuses(state);
    try {
      this.#canvas.render(
        state.nodes.map((node) => ({
          id: node.id,
          name: node.name,
          position: node.position,
          color: node.color,
          icon: node.media?.icon,
          rarityId: node.rarityId,
          revealed: true,
          status: statuses.get(node.id) ?? 'available',
        })),
        state.connections,
        state.rarities,
      );
      this.#canvas.setBackground(state.background);
    } catch (error) {
      reportFailure('não foi possível desenhar a constelação', error);
    }
  }

  #handleNodeSelected(nodeId: string | null): void {
    this.#selectedNodeId = nodeId;
    if (nodeId) playMediaSound(this.#state?.nodes.find((node) => node.id === nodeId)?.media?.soundSelect);
    void this.render({ parts: ['panel'] });
  }

  /** O Mestre mudou algo: toca os sons de revelar/desbloquear e redesenha (o canvas anima a diferença). */
  async #refresh(): Promise<void> {
    const next = await this.#service.getPlayerState(this.#actorId);
    const previous = new Map((this.#state?.nodes ?? []).map((node) => [node.id, node]));
    for (const node of next.nodes) {
      const before = previous.get(node.id);
      if (!before) playMediaSound(node.media?.soundReveal);
      else if (!before.unlocked && node.unlocked) playMediaSound(node.media?.soundUnlock);
    }
    this.#state = next;
    if (this.#selectedNodeId && !next.nodes.some((node) => node.id === this.#selectedNodeId)) {
      this.#selectedNodeId = null;
    }
    this.#renderCanvas();
    await this.render({ parts: ['panel'] });
  }
}
