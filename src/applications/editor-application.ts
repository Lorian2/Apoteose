import { ASPECT_TYPE_LABELS, MODULE_ID, NODE_STATUS_LABELS } from '../constants';
import { ConstellationError } from '../errors';
import { NebulaCanvas, type NebulaCanvasMode } from '../rendering/nebula-canvas';
import { ObservatoryApplication } from './observatory-application';
import { BackgroundMusicPlayer } from '../rendering/background-music';
import { ConstellationService } from '../services/constellation-service';
import { computeNodeStatuses, exclusivePartners } from '../utils/node-status';
import { escapeHTML } from '../utils/html';
import { playMediaSound } from '../utils/sound';
import type { AspectNode, ConstellationDefinition, NodeStatus, Position } from '../types/constellation';

interface EditorApplicationOptions {
  actorId: string;
}

const UNDO_LIMIT = 50;

const MODES: { id: NebulaCanvasMode; label: string; icon: string; hint: string }[] = [
  { id: 'select', label: 'Selecionar', icon: 'fa-solid fa-arrow-pointer', hint: 'Clique para editar, arraste para mover.' },
  { id: 'create', label: 'Criar', icon: 'fa-solid fa-star', hint: 'Clique no vazio para criar um Aspecto.' },
  { id: 'connect', label: 'Conectar', icon: 'fa-solid fa-diagram-project', hint: 'Clique na origem e depois no destino.' },
  { id: 'remove', label: 'Remover', icon: 'fa-solid fa-eraser', hint: 'Clique numa estrela ou caminho para remover.' },
];

const MEDIA_FIELDS = [
  { field: 'icon', label: 'Ícone', type: 'image' },
  { field: 'image', label: 'Imagem do Aspecto', type: 'image' },
  { field: 'soundReveal', label: 'Som ao revelar', type: 'audio' },
  { field: 'soundUnlock', label: 'Som ao desbloquear', type: 'audio' },
  { field: 'soundSelect', label: 'Som ao selecionar', type: 'audio' },
] as const;

type Action = (this: EditorApplication, event: PointerEvent, target: HTMLElement) => void;

/**
 * Editor do Mestre. O canvas PIXI cuida da interação direta (selecionar,
 * arrastar, criar, conectar, remover); o painel lateral edita o que está
 * selecionado. Toda escrita passa por `#run`, que guarda um retrato da
 * Definição Mestra para Desfazer/Refazer e redesenha tudo ao final.
 */
export class EditorApplication extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static override DEFAULT_OPTIONS = {
    classes: ['constelacao-apoteose', 'editor-application'],
    window: {
      title: 'CONSTELACAO_APOTEOSE.EditorTitle',
      icon: 'fa-solid fa-star',
      resizable: true,
    },
    position: {
      width: 1100,
      height: 700,
    },
    actions: {
      setMode: function (this: EditorApplication, _event: PointerEvent, target: HTMLElement) {
        this.#setMode((target.dataset.mode as NebulaCanvasMode) ?? 'select');
      },
      grantPoint: function (this: EditorApplication) {
        void this.#run(() => this.#service.grantPoint(this.#actorId));
      },
      revokePoint: function (this: EditorApplication) {
        void this.#run(() => this.#service.revokePoint(this.#actorId));
      },
      undo: function (this: EditorApplication) {
        void this.#undo();
      },
      redo: function (this: EditorApplication) {
        void this.#redo();
      },
      fitView: function (this: EditorApplication) {
        this.#canvas?.fitView();
      },
      openPlayerView: function (this: EditorApplication) {
        const existing = foundry.applications.instances.get(`constelacao-apoteose-observatory-${this.#actorId}`);
        if (existing) existing.bringToFront();
        else void new ObservatoryApplication(this.#actorId).render({ force: true });
      },
      focusNode: function (this: EditorApplication) {
        if (this.#selectedNodeId) this.#canvas?.focusNode(this.#selectedNodeId);
      },
      selectNode: function (this: EditorApplication, _event: PointerEvent, target: HTMLElement) {
        const nodeId = target.dataset.nodeId;
        if (!nodeId) return;
        this.#canvas?.setSelectedNode(nodeId);
        this.#canvas?.focusNode(nodeId);
        this.#handleNodeSelected(nodeId);
      },
      clearSelection: function (this: EditorApplication) {
        this.#clearSelection();
      },
      removeSelected: function (this: EditorApplication) {
        void this.#removeSelected();
      },
      reverseConnection: function (this: EditorApplication) {
        const connectionId = this.#selectedConnectionId;
        if (connectionId) void this.#run(() => this.#service.reverseConnection(this.#actorId, connectionId));
      },
      removeExclusion: function (this: EditorApplication, _event: PointerEvent, target: HTMLElement) {
        const nodeId = this.#selectedNodeId;
        const partnerId = target.dataset.partnerId;
        if (nodeId && partnerId) {
          void this.#run(() => this.#service.setExclusive(this.#actorId, nodeId, partnerId, false));
        }
      },
      clearNodeColor: function (this: EditorApplication) {
        const nodeId = this.#selectedNodeId;
        if (nodeId) void this.#run(() => this.#service.updateNode(this.#actorId, nodeId, { color: '' }));
      },
      pickMedia: function (this: EditorApplication, _event: PointerEvent, target: HTMLElement) {
        this.#pickMedia(target);
      },
      addCategory: function (this: EditorApplication) {
        const categories = [...this.#definition().categories, { id: foundry.utils.randomID(), label: 'Nova categoria' }];
        void this.#run(() => this.#service.updateCategories(this.#actorId, categories));
      },
      removeCategory: function (this: EditorApplication, _event: PointerEvent, target: HTMLElement) {
        const categories = this.#definition().categories.filter((category) => category.id !== target.dataset.categoryId);
        void this.#run(() => this.#service.updateCategories(this.#actorId, categories));
      },
      addRarity: function (this: EditorApplication) {
        const rarities = this.#definition().rarities;
        const next = [
          ...rarities,
          { id: foundry.utils.randomID(), label: 'Nova raridade', color: '#c9b6e4', order: rarities.length },
        ];
        void this.#run(() => this.#service.updateRarities(this.#actorId, next));
      },
      removeRarity: function (this: EditorApplication, _event: PointerEvent, target: HTMLElement) {
        const rarities = this.#definition().rarities.filter((rarity) => rarity.id !== target.dataset.rarityId);
        void this.#run(() => this.#service.updateRarities(this.#actorId, rarities));
      },
      logHistoryEntry: function (this: EditorApplication) {
        void this.#logHistoryEntry();
      },
      removeHistoryEntry: function (this: EditorApplication, _event: PointerEvent, target: HTMLElement) {
        const index = Number(target.dataset.index);
        if (Number.isInteger(index)) void this.#run(() => this.#service.removeHistoryEntry(this.#actorId, index));
      },
    } satisfies Record<string, Action>,
  };

  static override PARTS = {
    toolbar: {
      template: `modules/${MODULE_ID}/templates/editor-toolbar.hbs`,
      classes: ['constelacao-toolbar'],
      scrollable: [''],
    },
    canvas: {
      template: `modules/${MODULE_ID}/templates/editor-canvas.hbs`,
      classes: ['constelacao-canvas-placeholder'],
    },
    panel: {
      template: `modules/${MODULE_ID}/templates/editor-panel.hbs`,
      classes: ['constelacao-panel'],
      scrollable: [''],
    },
  };

  readonly #actorId: string;
  readonly #service = new ConstellationService();
  readonly #music = new BackgroundMusicPlayer();
  #canvas: NebulaCanvas | undefined;
  #lastDefinition: ConstellationDefinition | undefined;
  #selectedNodeId: string | null = null;
  #selectedConnectionId: string | null = null;
  #mode: NebulaCanvasMode = 'select';
  #undoStack: ConstellationDefinition[] = [];
  #redoStack: ConstellationDefinition[] = [];
  #journalHook: number | undefined;

  constructor(options: EditorApplicationOptions) {
    super({ id: `constelacao-apoteose-editor-${options.actorId}` });
    this.#actorId = options.actorId;
  }

  override get title(): string {
    const base = game.i18n?.localize('CONSTELACAO_APOTEOSE.EditorTitle') ?? 'Constelação da Apoteose — Editor';
    const name = game.actors?.get(this.#actorId)?.name;
    return name ? `${base}: ${name}` : base;
  }

  protected override async _prepareContext(): Promise<object> {
    const definition = (this.#lastDefinition ??= await this.#service.getMasterDefinition(this.#actorId));
    void this.#music.setTrack(definition.backgroundMusic);
    const statuses = computeNodeStatuses(definition.nodes, definition.connections, definition.exclusions);
    const nodeName = (id: string) => definition.nodes.find((node) => node.id === id)?.name ?? '';

    const selectedNode = this.#selectedNodeId
      ? definition.nodes.find((node) => node.id === this.#selectedNodeId)
      : undefined;
    const selectedConnection = this.#selectedConnectionId
      ? definition.connections.find((connection) => connection.id === this.#selectedConnectionId)
      : undefined;
    const currentMode = MODES.find((mode) => mode.id === this.#mode) ?? MODES[0];

    return {
      actorName: game.actors?.get(this.#actorId)?.name ?? '(Ator não encontrado)',
      nodeCount: definition.nodes.length,
      unlockedCount: definition.nodes.filter((node) => node.unlocked).length,
      hiddenCount: definition.nodes.filter((node) => node.visibility === 'hidden').length,
      unspentPoints: definition.unspentPoints,
      modes: MODES.map((mode) => ({ ...mode, active: mode.id === this.#mode })),
      modeHint: currentMode.hint,
      canUndo: this.#undoStack.length > 0,
      canRedo: this.#redoStack.length > 0,
      categories: definition.categories,
      rarities: definition.rarities,
      background: definition.background ?? '',
      backgroundMusic: definition.backgroundMusic ?? '',
      history: definition.history
        .map((entry, index) => ({ ...entry, index, nodeName: entry.nodeId ? nodeName(entry.nodeId) : '' }))
        .reverse(),
      nodeTypes: Object.entries(ASPECT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
      selectedNode: selectedNode
        ? this.#toPanelViewModel(selectedNode, definition, statuses.get(selectedNode.id) ?? 'available')
        : null,
      selectedConnection: selectedConnection
        ? {
            fromId: selectedConnection.fromNodeId,
            toId: selectedConnection.toNodeId,
            fromName: nodeName(selectedConnection.fromNodeId),
            toName: nodeName(selectedConnection.toNodeId),
          }
        : null,
    };
  }

  protected override async _onFirstRender(context: object, options: object): Promise<void> {
    await super._onFirstRender(context, options);
    this.#mountCanvas();

    // Delegação no elemento raiz: sobrevive aos re-renders parciais.
    this.element.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('[data-constellation-form]')) void this.#onConstellationFieldChange(target);
      else if (target.closest('[data-panel-form]')) void this.#onPanelFieldChange(target);
    });
    this.element.addEventListener('keydown', this.#onKeyDown);

    // Outro Mestre (ou outra janela) mexeu nesta constelação.
    this.#journalHook = Hooks.on(
      'updateJournalEntry',
      (journal: JournalEntry, _changes: object, _options: object, userId: string) => {
        if (userId === game.user?.id || journal.id !== this.#service.getMasterJournalId(this.#actorId)) return;
        void this.#reload();
      },
    );
  }

  protected override _onClose(options: object): void {
    if (this.#journalHook !== undefined) Hooks.off('updateJournalEntry', this.#journalHook);
    this.#canvas?.destroy();
    this.#canvas = undefined;
    this.#music.stop();
    super._onClose(options);
  }

  // -------------------------------------------------------------------
  // Painel
  // -------------------------------------------------------------------

  #toPanelViewModel(node: AspectNode, definition: ConstellationDefinition, status: NodeStatus) {
    const isInitial = node.id === definition.initialNodeId;
    const partnerIds = new Set(exclusivePartners(node.id, definition.exclusions));
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

    let unlockHint = '';
    let unlockDisabled = false;
    if (isInitial) {
      unlockHint = '(Aspecto inicial)';
      unlockDisabled = true;
    } else if (node.unlocked) {
      unlockHint = '(desmarcar devolve o Ponto)';
    } else if (status === 'excluded') {
      unlockHint = '(caminho fechado)';
      unlockDisabled = true;
    } else if (status === 'prerequisite') {
      unlockHint = '(falta um Aspecto anterior)';
      unlockDisabled = true;
    } else if (definition.unspentPoints <= 0) {
      unlockHint = '(conceda um Ponto antes)';
      unlockDisabled = true;
    } else {
      unlockHint = `(gasta 1 de ${definition.unspentPoints} Ponto(s))`;
    }

    return {
      id: node.id,
      name: node.name,
      subtitle: node.subtitle ?? '',
      quote: node.quote ?? '',
      description: node.description ?? '',
      requirements: node.requirements ?? '',
      gmNotes: node.gmNotes ?? '',
      categoryId: node.categoryId ?? '',
      rarityId: node.rarityId,
      type: node.type,
      color: node.color ?? '',
      colorValue: node.color || definition.rarities.find((rarity) => rarity.id === node.rarityId)?.color || '#c9b6e4',
      revealed: node.visibility === 'revealed',
      unlocked: node.unlocked,
      isInitial,
      status,
      statusLabel: NODE_STATUS_LABELS[status],
      unlockHint,
      unlockDisabled,
      exclusivePartners: definition.nodes.filter((candidate) => partnerIds.has(candidate.id)).sort(byName),
      exclusionCandidates: definition.nodes
        .filter((candidate) => candidate.id !== node.id && !partnerIds.has(candidate.id))
        .sort(byName),
      mediaFields: MEDIA_FIELDS.map((entry) => ({ ...entry, value: node.media?.[entry.field] ?? '' })),
    };
  }

  async #onPanelFieldChange(target: HTMLElement): Promise<void> {
    const nodeId = target.closest<HTMLElement>('[data-panel-form]')?.dataset.nodeId;
    const input = target as HTMLInputElement;
    const field = input.name;
    if (!nodeId || !field) return;
    const node = this.#definition().nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;

    if (field === 'visibility-toggle') {
      await this.#run(async () => {
        if (input.checked) {
          await this.#service.revealNode(this.#actorId, nodeId);
          playMediaSound(node.media.soundReveal);
        } else {
          await this.#service.hideNode(this.#actorId, nodeId);
        }
      });
    } else if (field === 'unlocked-toggle') {
      await this.#run(async () => {
        if (input.checked) {
          await this.#service.unlockNode(this.#actorId, nodeId);
          playMediaSound(node.media.soundUnlock);
        } else {
          await this.#service.lockNode(this.#actorId, nodeId);
        }
      });
    } else if (field === 'add-exclusion') {
      const partnerId = input.value;
      if (partnerId) await this.#run(() => this.#service.setExclusive(this.#actorId, nodeId, partnerId, true));
    } else if (field.startsWith('media.')) {
      const key = field.slice('media.'.length);
      const media = { ...node.media, [key]: input.value.trim() };
      await this.#run(() => this.#service.updateNode(this.#actorId, nodeId, { media }));
    } else {
      const value = field === 'name' ? input.value.trim() || 'Aspecto sem nome' : input.value;
      await this.#run(() => this.#service.updateNode(this.#actorId, nodeId, { [field]: value } as Partial<AspectNode>));
    }
  }

  async #onConstellationFieldChange(target: HTMLElement): Promise<void> {
    if (!(target instanceof HTMLInputElement)) return;
    const definition = this.#definition();
    const field = target.name;

    if (field === 'background' || field === 'backgroundMusic') {
      await this.#run(() =>
        this.#service.updateConstellationSettings(this.#actorId, { [field]: target.value.trim() }),
      );
    } else if (field === 'category-label' || field === 'category-color') {
      const key = field === 'category-label' ? 'label' : 'color';
      const categories = definition.categories.map((category) =>
        category.id === target.dataset.categoryId ? { ...category, [key]: target.value } : category,
      );
      await this.#run(() => this.#service.updateCategories(this.#actorId, categories));
    } else if (field === 'rarity-label' || field === 'rarity-color' || field === 'rarity-order') {
      const key = field === 'rarity-label' ? 'label' : field === 'rarity-color' ? 'color' : 'order';
      const value = key === 'order' ? Number(target.value) || 0 : target.value;
      const rarities = definition.rarities.map((rarity) =>
        rarity.id === target.dataset.rarityId ? { ...rarity, [key]: value } : rarity,
      );
      await this.#run(() => this.#service.updateRarities(this.#actorId, rarities));
    }
  }

  // -------------------------------------------------------------------
  // Canvas
  // -------------------------------------------------------------------

  #mountCanvas(): void {
    const container = this.element.querySelector<HTMLElement>('[data-canvas-container]');
    if (!container) return;

    // Clicar no canvas dá foco a ele: os atalhos (Del, Ctrl+Z…) passam a
    // valer aqui, e `data-keyboard-focus` impede que o Foundry os use no
    // canvas da cena ao mesmo tempo.
    container.addEventListener('pointerdown', () => container.focus({ preventScroll: true }));

    this.#canvas = new NebulaCanvas(
      container,
      {
        onNodeSelected: (nodeId) => this.#handleNodeSelected(nodeId),
        onConnectionSelected: (connectionId) => this.#handleConnectionSelected(connectionId),
        onNodeMoved: (nodeId, position) => void this.#handleNodeMoved(nodeId, position),
        onConnectionRequested: (fromId, toId) => void this.#handleConnectionRequested(fromId, toId),
        onCreateRequested: (position) => void this.#handleCreateRequested(position),
        onNodeRemoveRequested: (nodeId) => void this.#removeNode(nodeId),
        onConnectionRemoveRequested: (connectionId) => void this.#removeConnection(connectionId),
      },
      { editable: true },
    );
    this.#canvas.setMode(this.#mode);
    this.#renderCanvas();
  }

  #renderCanvas(): void {
    const definition = this.#lastDefinition;
    if (!this.#canvas || !definition) return;
    const statuses = computeNodeStatuses(definition.nodes, definition.connections, definition.exclusions);

    this.#canvas.render(
      definition.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        position: node.position,
        color: node.color,
        icon: node.media.icon,
        rarityId: node.rarityId,
        revealed: node.visibility === 'revealed',
        status: statuses.get(node.id) ?? 'available',
      })),
      definition.connections,
      definition.rarities,
      definition.exclusions,
    );
    this.#canvas.setBackground(definition.background);
  }

  #handleNodeSelected(nodeId: string | null): void {
    this.#selectedNodeId = nodeId;
    this.#selectedConnectionId = null;
    if (nodeId) {
      playMediaSound(this.#definition().nodes.find((node) => node.id === nodeId)?.media.soundSelect);
    }
    void this.render({ parts: ['panel'] });
  }

  #handleConnectionSelected(connectionId: string): void {
    this.#selectedNodeId = null;
    this.#selectedConnectionId = connectionId;
    void this.render({ parts: ['panel'] });
  }

  #clearSelection(): void {
    this.#selectedNodeId = null;
    this.#selectedConnectionId = null;
    this.#canvas?.setSelectedNode(null);
    this.#canvas?.selectConnection(null);
    void this.render({ parts: ['panel'] });
  }

  async #handleNodeMoved(nodeId: string, position: Position): Promise<void> {
    await this.#run(() => this.#service.moveNode(this.#actorId, nodeId, position), { renderPanel: false });
  }

  async #handleConnectionRequested(fromNodeId: string, toNodeId: string): Promise<void> {
    await this.#run(() => this.#service.connectNodes(this.#actorId, fromNodeId, toNodeId));
  }

  async #handleCreateRequested(position: Position): Promise<void> {
    await this.#run(async () => {
      const node = await this.#service.createNode(this.#actorId, position);
      this.#selectedNodeId = node.id;
      this.#selectedConnectionId = null;
      this.#canvas?.setSelectedNode(node.id);
    });
    if (this.#mode === 'create') this.#setMode('select');
    // Já deixa o nome pronto para digitar.
    const nameInput = this.element.querySelector<HTMLInputElement>('[data-panel-form] input[name="name"]');
    nameInput?.focus();
    nameInput?.select();
  }

  async #removeSelected(): Promise<void> {
    if (this.#selectedNodeId) await this.#removeNode(this.#selectedNodeId);
    else if (this.#selectedConnectionId) await this.#removeConnection(this.#selectedConnectionId);
  }

  async #removeNode(nodeId: string): Promise<void> {
    const node = this.#definition().nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    if (nodeId === this.#definition().initialNodeId) {
      ui.notifications?.warn('O Aspecto inicial não pode ser removido.');
      return;
    }
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: 'Remover Aspecto' },
      content: `<p>Remover <strong>${escapeHTML(node.name)}</strong> e os caminhos ligados a ele?</p>
        <p class="hint">Dá para desfazer com Ctrl+Z enquanto o Editor estiver aberto.</p>`,
    });
    if (!confirmed) return;
    await this.#run(() => this.#service.removeNode(this.#actorId, nodeId));
    if (this.#selectedNodeId === nodeId) this.#clearSelection();
  }

  async #removeConnection(connectionId: string): Promise<void> {
    await this.#run(() => this.#service.disconnectNodes(this.#actorId, connectionId));
    if (this.#selectedConnectionId === connectionId) this.#clearSelection();
  }

  #setMode(mode: NebulaCanvasMode): void {
    this.#mode = this.#mode === mode && mode !== 'select' ? 'select' : mode;
    this.#canvas?.setMode(this.#mode);
    void this.render({ parts: ['toolbar'] });
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable]')) return;
    const key = event.key.toLowerCase();
    const ctrl = event.ctrlKey || event.metaKey;
    let handled = true;

    if (key === 'escape') {
      if (this.#mode !== 'select') this.#setMode('select');
      else if (this.#selectedNodeId || this.#selectedConnectionId) this.#clearSelection();
      else handled = false;
    } else if (key === 'delete' || key === 'backspace') {
      void this.#removeSelected();
    } else if (ctrl && key === 'z') {
      void (event.shiftKey ? this.#redo() : this.#undo());
    } else if (ctrl && key === 'y') {
      void this.#redo();
    } else if (!ctrl && key === 'f') {
      this.#canvas?.fitView();
    } else if (!ctrl && key === 'n' && this.#canvas) {
      void this.#handleCreateRequested(this.#canvas.viewCenter());
    } else {
      handled = false;
    }

    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  // -------------------------------------------------------------------
  // Escrita, desfazer, recarga
  // -------------------------------------------------------------------

  #definition(): ConstellationDefinition {
    if (!this.#lastDefinition) throw new Error(`${MODULE_ID} | Editor sem Definição Mestra carregada.`);
    return this.#lastDefinition;
  }

  /**
   * Executa uma escrita: guarda o retrato para Desfazer, trata erros
   * previsíveis com um aviso e redesenha canvas, ferramentas e painel.
   */
  async #run(
    task: () => Promise<unknown>,
    { renderPanel = true, recordUndo = true }: { renderPanel?: boolean; recordUndo?: boolean } = {},
  ): Promise<void> {
    const snapshot = this.#lastDefinition ? foundry.utils.deepClone(this.#lastDefinition) : undefined;
    try {
      await task();
      if (recordUndo && snapshot) {
        this.#undoStack.push(snapshot);
        if (this.#undoStack.length > UNDO_LIMIT) this.#undoStack.shift();
        this.#redoStack = [];
      }
    } catch (error) {
      if (error instanceof ConstellationError) ui.notifications?.warn(error.message);
      else {
        console.error(`${MODULE_ID} |`, error);
        ui.notifications?.error('Não foi possível salvar a alteração. Veja o console (F12).');
      }
    }
    await this.#reload(renderPanel);
  }

  async #reload(renderPanel = true): Promise<void> {
    this.#lastDefinition = await this.#service.getMasterDefinition(this.#actorId);
    const definition = this.#lastDefinition;
    if (this.#selectedNodeId && !definition.nodes.some((node) => node.id === this.#selectedNodeId)) {
      this.#selectedNodeId = null;
    }
    if (
      this.#selectedConnectionId &&
      !definition.connections.some((connection) => connection.id === this.#selectedConnectionId)
    ) {
      this.#selectedConnectionId = null;
    }
    this.#renderCanvas();
    await this.render({ parts: renderPanel ? ['toolbar', 'panel'] : ['toolbar'] });
  }

  async #undo(): Promise<void> {
    const snapshot = this.#undoStack.pop();
    if (!snapshot || !this.#lastDefinition) return;
    this.#redoStack.push(foundry.utils.deepClone(this.#lastDefinition));
    await this.#run(() => this.#service.restoreDefinition(this.#actorId, snapshot), { recordUndo: false });
  }

  async #redo(): Promise<void> {
    const snapshot = this.#redoStack.pop();
    if (!snapshot || !this.#lastDefinition) return;
    this.#undoStack.push(foundry.utils.deepClone(this.#lastDefinition));
    await this.#run(() => this.#service.restoreDefinition(this.#actorId, snapshot), { recordUndo: false });
  }

  // -------------------------------------------------------------------
  // Mídia e histórico
  // -------------------------------------------------------------------

  #pickMedia(button: HTMLElement): void {
    const field = button.dataset.mediaField;
    if (!field) return;
    const isConstellation = button.dataset.scope === 'constellation';
    const nodeId = this.#selectedNodeId;
    const definition = this.#definition();
    const node = nodeId ? definition.nodes.find((candidate) => candidate.id === nodeId) : undefined;
    if (!isConstellation && !node) return;

    const current = isConstellation
      ? (definition[field as 'background' | 'backgroundMusic'] ?? '')
      : (node!.media[field as keyof AspectNode['media']] ?? '');

    // 'imagevideo' cobre imagem e vídeo; não existe tipo genérico "file".
    const FilePickerClass = (foundry.applications.apps.FilePicker as unknown as { implementation: any })
      .implementation;
    const picker = new FilePickerClass({
      type: button.dataset.mediaType === 'audio' ? 'audio' : 'imagevideo',
      current,
      callback: (path: string) => {
        if (!path) return;
        if (isConstellation) {
          void this.#run(() => this.#service.updateConstellationSettings(this.#actorId, { [field]: path }));
        } else if (nodeId && node) {
          const media = { ...node.media, [field]: path };
          void this.#run(() => this.#service.updateNode(this.#actorId, nodeId, { media }));
        }
      },
    });
    void picker.render(true);
  }

  /** Registra um momento na linha do tempo (GDD §12). */
  async #logHistoryEntry(): Promise<void> {
    const definition = this.#definition();
    const options = [...definition.nodes]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((node) => `<option value="${node.id}">${escapeHTML(node.name)}</option>`)
      .join('');

    const data = (await foundry.applications.api.DialogV2.input({
      window: { title: 'Nova entrada na linha do tempo' },
      content: `
        <div class="form-group">
          <label>Título do capítulo</label>
          <input type="text" name="chapterTitle" placeholder="ex.: O Último Bastião" autofocus>
        </div>
        <div class="form-group">
          <label>Data</label>
          <input type="text" name="date" value="${escapeHTML(new Date().toLocaleDateString('pt-BR'))}">
        </div>
        <div class="form-group">
          <label>Aspecto relacionado</label>
          <select name="nodeId"><option value="">(nenhum)</option>${options}</select>
        </div>`,
      ok: { label: 'Registrar' },
    })) as { chapterTitle?: string; date?: string; nodeId?: string } | null;
    if (!data) return;

    const chapterTitle = String(data.chapterTitle ?? '').trim();
    if (!chapterTitle) {
      ui.notifications?.warn('Escreva um título para o capítulo antes de registrar.');
      return;
    }
    await this.#run(() =>
      this.#service.addHistoryEntry(this.#actorId, {
        date: String(data.date ?? '').trim() || new Date().toLocaleDateString('pt-BR'),
        nodeId: String(data.nodeId ?? ''),
        chapterTitle,
      }),
    );
  }
}
