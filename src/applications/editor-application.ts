import { ASPECT_TYPE_LABELS, MODULE_ID } from '../constants';
import { ConstellationError } from '../errors';
import { NebulaCanvas } from '../rendering/nebula-canvas';
import { ConstellationService } from '../services/constellation-service';
import { computeBlockedNodeIds } from '../utils/exclusion';
import { computePrerequisiteLockedNodeIds } from '../utils/prerequisites';
import { playMediaSound } from '../utils/sound';
import { BackgroundMusicPlayer } from '../rendering/background-music';
import type { AspectNode, ConstellationDefinition, Position } from '../types/constellation';

interface EditorApplicationOptions {
  actorId: string;
}

/**
 * Janela principal do Editor do Mestre (Arquitetura de Software, seção 2 ·
 * Wireframes, seção 1-2). O canvas PIXI já suporta seleção, arraste
 * (persistido via moveNode) e um modo de conexão (persistido via
 * connectNodes). Bloqueio mútuo e criação de nó pelo canvas ainda não
 * existem — ficam para a próxima etapa.
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
      width: 900,
      height: 640,
    },
    actions: {
      toggleConnectMode(this: EditorApplication) {
        this.#toggleConnectMode();
      },
      toggleCreateMode(this: EditorApplication) {
        this.#toggleCreateMode();
      },
      toggleRemoveMode(this: EditorApplication) {
        this.#toggleRemoveMode();
      },
      grantPoint(this: EditorApplication) {
        void this.#handleGrantPoint();
      },
      revokePoint(this: EditorApplication) {
        void this.#handleRevokePoint();
      },
      recenterView(this: EditorApplication) {
        this.#canvas?.recenterView();
      },
      addCategory(this: EditorApplication) {
        void this.#handleAddCategory();
      },
      removeCategory(this: EditorApplication, _event: PointerEvent, target: HTMLElement) {
        void this.#handleRemoveCategory(target.dataset.categoryId);
      },
      addRarity(this: EditorApplication) {
        void this.#handleAddRarity();
      },
      removeRarity(this: EditorApplication, _event: PointerEvent, target: HTMLElement) {
        void this.#handleRemoveRarity(target.dataset.rarityId);
      },
      logHistoryEntry(this: EditorApplication) {
        void this.#handleLogHistoryEntry();
      },
    },
  };

  static override PARTS = {
    toolbar: {
      template: `modules/${MODULE_ID}/templates/editor-toolbar.hbs`,
      classes: ['constelacao-toolbar'],
    },
    canvas: {
      template: `modules/${MODULE_ID}/templates/editor-canvas.hbs`,
      classes: ['constelacao-canvas-placeholder'],
    },
    panel: {
      template: `modules/${MODULE_ID}/templates/editor-panel.hbs`,
      classes: ['constelacao-panel'],
    },
  };

  readonly #actorId: string;
  readonly #service: ConstellationService;
  readonly #music = new BackgroundMusicPlayer();
  #canvas: NebulaCanvas | undefined;
  #lastDefinition: ConstellationDefinition | undefined;
  #selectedNodeId: string | null = null;
  #connectModeActive = false;
  #createModeActive = false;
  #removeModeActive = false;

  constructor(options: EditorApplicationOptions) {
    super({ id: `constelacao-apoteose-editor-${options.actorId}` });
    this.#actorId = options.actorId;
    this.#service = new ConstellationService();
  }

  protected override async _prepareContext(): Promise<object> {
    const actor = game.actors?.get(this.#actorId);
    const definition = await this.#service.getMasterDefinition(this.#actorId);
    this.#lastDefinition = definition;
    void this.#music.setTrack(definition.backgroundMusic);

    const selectedNode = this.#selectedNodeId
      ? definition.nodes.find((node) => node.id === this.#selectedNodeId)
      : undefined;

    return {
      actorName: actor?.name ?? '(Ator não encontrado)',
      nodeCount: definition.nodes.length,
      hiddenCount: definition.nodes.filter((node) => node.visibility === 'hidden').length,
      unspentPoints: definition.unspentPoints,
      connectModeActive: this.#connectModeActive,
      createModeActive: this.#createModeActive,
      removeModeActive: this.#removeModeActive,
      categories: definition.categories,
      rarities: definition.rarities,
      background: definition.background ?? '',
      backgroundMusic: definition.backgroundMusic ?? '',
      history: [...definition.history].reverse().map((entry) => ({
        ...entry,
        nodeName: definition.nodes.find((node) => node.id === entry.nodeId)?.name ?? '',
      })),
      nodeTypes: Object.entries(ASPECT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
      selectedNode: selectedNode ? this.#toPanelViewModel(selectedNode, definition) : null,
      isGM: game.user?.isGM ?? false,
    };
  }

  protected override async _onFirstRender(context: object, options: object): Promise<void> {
    await super._onFirstRender(context, options);
    this.#mountCanvas();
    // Delegação num elemento estável: sobrevive aos re-renders parciais do
    // painel, que substituem só o conteúdo interno, não este listener.
    this.element.addEventListener('change', (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('[data-constellation-form]')) {
        void this.#onConstellationFieldChange(event);
      } else {
        void this.#onPanelFieldChange(event);
      }
    });
    // Listener para botões de file picker — usa .closest() pra ser mais robusto
    this.element.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest('.constelacao-media-picker');
      if (button instanceof HTMLButtonElement) {
        event.preventDefault();
        void this.#handleMediaPickerClick(button);
      }
    });
    // Atalhos de teclado
    this.element.addEventListener('keydown', this.#onKeyDown);
  }

  protected override _onClose(options: object): void {
    this.#canvas?.destroy();
    this.#canvas = undefined;
    this.#music.stop();
    super._onClose(options);
  }

  #toPanelViewModel(node: AspectNode, definition: ConstellationDefinition) {
    const blocked = computeBlockedNodeIds(definition.nodes, definition.connections).has(node.id);
    const prerequisiteLocked = computePrerequisiteLockedNodeIds(definition.nodes, definition.connections).has(
      node.id,
    );

    // Lista os OUTROS Aspectos conectados por pelo menos um caminho (não faz
    // sentido excluir um nó sem nenhuma ligação, nem a si mesmo) — marcar um
    // deles fecha TODOS os caminhos que chegam até ele de uma vez, então não
    // tem como esquecer de marcar "só metade" quando o alvo tem mais de uma
    // origem (Banco de Dados, seção 5).
    const excludableTargets = definition.nodes
      .filter((candidate) => candidate.id !== node.id)
      .map((candidate) => {
        const touching = definition.connections.filter(
          (connection) => connection.fromNodeId === candidate.id || connection.toNodeId === candidate.id,
        );
        return { id: candidate.id, name: candidate.name, touching };
      })
      .filter((entry) => entry.touching.length > 0)
      .map((entry) => ({
        id: entry.id,
        label: entry.name,
        excluded: entry.touching.every((connection) => (connection.excludedByNodeIds ?? []).includes(node.id)),
      }));

    return {
      id: node.id,
      name: node.name,
      subtitle: node.subtitle ?? '',
      quote: node.quote ?? '',
      description: node.description ?? '',
      gmNotes: node.gmNotes ?? '',
      categoryId: node.categoryId ?? '',
      rarityId: node.rarityId,
      type: node.type,
      revealed: node.visibility === 'revealed',
      unlocked: node.unlocked,
      media: node.media ?? {},
      excludableTargets,
      blocked,
      prerequisiteLocked,
    };
  }

  #mountCanvas(): void {
    const container = this.element.querySelector<HTMLElement>('[data-canvas-container]');
    if (!container || !this.#lastDefinition) {
      return;
    }

    this.#canvas = new NebulaCanvas(container, {
      onNodeSelected: (nodeId) => this.#handleNodeSelected(nodeId),
      onNodeMoved: (nodeId, position) => this.#handleNodeMoved(nodeId, position),
      onConnectionRequested: (fromId, toId) => this.#handleConnectionRequested(fromId, toId),
      onCreateRequested: (position) => this.#handleCreateRequested(position),
      onNodeRemoveRequested: (nodeId) => void this.#handleNodeRemoveRequested(nodeId),
      onConnectionRemoveRequested: (connectionId) => void this.#handleConnectionRemoveRequested(connectionId),
    });
    this.#renderCanvas();
  }

  #renderCanvas(): void {
    if (!this.#canvas || !this.#lastDefinition) {
      return;
    }

    // Mapeia AspectNode (Banco de Dados) pro formato RenderableNode esperado pelo canvas
    const blockedIds = computeBlockedNodeIds(this.#lastDefinition.nodes, this.#lastDefinition.connections);
    const prerequisiteLockedIds = computePrerequisiteLockedNodeIds(
      this.#lastDefinition.nodes,
      this.#lastDefinition.connections,
    );
    const renderableNodes = this.#lastDefinition.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      color: node.color,
      icon: node.media.icon,
      rarityId: node.rarityId,
      revealed: node.visibility === 'revealed',
      unlocked: node.unlocked,
      blocked: blockedIds.has(node.id),
      prerequisiteLocked: prerequisiteLockedIds.has(node.id),
    }));

    this.#canvas.render(renderableNodes, this.#lastDefinition.connections, this.#lastDefinition.rarities);
    this.#canvas.setBackground(this.#lastDefinition.background);
  }

  #handleNodeSelected(nodeId: string | null): void {
    this.#selectedNodeId = nodeId;
    if (nodeId) {
      const node = this.#lastDefinition?.nodes.find((candidate) => candidate.id === nodeId);
      playMediaSound(node?.media.soundSelect);
    }
    void this.render({ parts: ['panel'] });
  }

  #handleNodeMoved(nodeId: string, position: Position): void {
    // Persiste em segundo plano — o canvas já mostra a estrela na posição
    // final, não é preciso esperar a escrita para continuar a interação.
    void this.#service.moveNode(this.#actorId, nodeId, position);
  }

  async #handleConnectionRequested(fromNodeId: string, toNodeId: string): Promise<void> {
    await this.#service.connectNodes(this.#actorId, fromNodeId, toNodeId);
    this.#lastDefinition = await this.#service.getMasterDefinition(this.#actorId);
    ui.notifications?.info('Caminho criado!');
    this.#renderCanvas();
    this.#connectModeActive = false;
    this.#canvas?.setMode('select');
    void this.render({ parts: ['toolbar'] });
  }

  async #handleCreateRequested(position: Position): Promise<void> {
    const node = await this.#service.createNode(this.#actorId, position);
    this.#lastDefinition = await this.#service.getMasterDefinition(this.#actorId);
    ui.notifications?.info('Aspecto criado!');
    this.#renderCanvas();
    this.#createModeActive = false;
    this.#canvas?.setMode('select');
    this.#selectedNodeId = node.id;
    void this.render({ parts: ['toolbar', 'panel'] });
  }

  async #onPanelFieldChange(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const form = target.closest('[data-panel-form]');
    if (!(form instanceof HTMLElement)) {
      return;
    }
    const nodeId = form.dataset.nodeId;
    const field = (target as HTMLInputElement).name;
    if (!nodeId || !field) {
      return;
    }

    try {
      if (field === 'visibility-toggle') {
        const checked = (target as HTMLInputElement).checked;
        const node = this.#lastDefinition?.nodes.find((candidate) => candidate.id === nodeId);
        if (checked) {
          await this.#service.revealNode(this.#actorId, nodeId);
          playMediaSound(node?.media.soundReveal);
          ui.notifications?.info('Aspecto revelado ao jogador!');
        } else {
          await this.#service.hideNode(this.#actorId, nodeId);
          ui.notifications?.info('Aspecto ocultado do jogador!');
        }
      } else if (field === 'unlocked-toggle') {
        const checked = (target as HTMLInputElement).checked;
        const node = this.#lastDefinition?.nodes.find((candidate) => candidate.id === nodeId);
        if (checked) {
          await this.#service.unlockNode(this.#actorId, nodeId);
          playMediaSound(node?.media.soundUnlock);
          ui.notifications?.info('Aspecto desbloqueado! Um Ponto da Apoteose foi consumido.');
        } else {
          await this.#service.lockNode(this.#actorId, nodeId);
          ui.notifications?.info('Desbloqueio revertido, ponto devolvido!');
        }
      } else if (field === 'exclude-target') {
        // Marca/desmarca ESTE nó como "exclusor" de um Aspecto-alvo inteiro
        // (Banco de Dados, seção 5) — precisa tocar TODOS os caminhos que
        // chegam até o alvo de uma vez (não só um), senão o alvo nunca fica
        // de fato bloqueado enquanto sobrar um caminho aberto até ele.
        const checked = (target as HTMLInputElement).checked;
        const targetNodeId = (target as HTMLInputElement).value;
        const touchingConnections = (this.#lastDefinition?.connections ?? []).filter(
          (connection) => connection.fromNodeId === targetNodeId || connection.toNodeId === targetNodeId,
        );
        for (const connection of touchingConnections) {
          const current = new Set(connection.excludedByNodeIds ?? []);
          if (checked) {
            current.add(nodeId);
          } else {
            current.delete(nodeId);
          }
          await this.#service.setExclusion(this.#actorId, connection.id, Array.from(current));
        }
      } else {
        const value = (target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
        
        // Campos aninhados como "media.icon" precisam de estrutura especial
        if (field.includes('.')) {
          const [parent, child] = field.split('.');
          await this.#service.updateNode(this.#actorId, nodeId, {
            [parent]: {
              ...((this.#lastDefinition?.nodes.find(n => n.id === nodeId)?.[parent as keyof AspectNode] ?? {}) as Record<string, unknown>),
              [child]: value,
            },
          } as Partial<AspectNode>);
        } else {
          await this.#service.updateNode(this.#actorId, nodeId, { [field]: value } as Partial<AspectNode>);
        }
      }
    } catch (error) {
      if (error instanceof ConstellationError) {
        // Erro previsível (ex.: sem Pontos da Apoteose disponíveis) — avisa
        // e deixa o re-render abaixo corrigir o estado visual do formulário.
        ui.notifications?.warn(error.message);
      } else {
        throw error;
      }
    }

    this.#lastDefinition = await this.#service.getMasterDefinition(this.#actorId);
    this.#renderCanvas();
    void this.render({ parts: ['panel'] });
  }

  /**
   * Campos que pertencem à constelação inteira (fundo/música/categorias/
   * raridades), não a um Aspecto — vivem num form separado
   * (`data-constellation-form`), sem `data-node-id`, então não passam por
   * `#onPanelFieldChange`.
   */
  async #onConstellationFieldChange(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    const field = target.name;

    if (field === 'background' || field === 'backgroundMusic') {
      try {
        await this.#service.updateConstellationSettings(
          this.#actorId,
          { [field]: target.value } as Partial<Pick<ConstellationDefinition, 'background' | 'backgroundMusic'>>,
        );
      } catch (error) {
        if (error instanceof ConstellationError) {
          ui.notifications?.warn(error.message);
        } else {
          throw error;
        }
      }
      this.#lastDefinition = await this.#service.getMasterDefinition(this.#actorId);
      this.#renderCanvas();
      void this.render({ parts: ['panel'] });
      return;
    }

    if (field === 'category-label' || field === 'category-color') {
      const categoryId = target.dataset.categoryId;
      if (!categoryId || !this.#lastDefinition) {
        return;
      }
      const categories = this.#lastDefinition.categories.map((category) =>
        category.id === categoryId
          ? { ...category, [field === 'category-label' ? 'label' : 'color']: target.value }
          : category,
      );
      await this.#service.updateCategories(this.#actorId, categories);
      this.#lastDefinition = await this.#service.getMasterDefinition(this.#actorId);
      void this.render({ parts: ['panel'] });
      return;
    }

    if (field === 'rarity-label' || field === 'rarity-color' || field === 'rarity-order') {
      const rarityId = target.dataset.rarityId;
      if (!rarityId || !this.#lastDefinition) {
        return;
      }
      const key = field === 'rarity-label' ? 'label' : field === 'rarity-color' ? 'color' : 'order';
      const value = key === 'order' ? Number(target.value) || 0 : target.value;
      const rarities = this.#lastDefinition.rarities.map((rarity) =>
        rarity.id === rarityId ? { ...rarity, [key]: value } : rarity,
      );
      await this.#service.updateRarities(this.#actorId, rarities);
      this.#lastDefinition = await this.#service.getMasterDefinition(this.#actorId);
      this.#renderCanvas(); // cor da raridade afeta a cor da estrela no canvas
      void this.render({ parts: ['panel'] });
      return;
    }
  }

  async #handleNodeRemoveRequested(nodeId: string): Promise<void> {
    const node = this.#lastDefinition?.nodes.find((candidate) => candidate.id === nodeId);
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: 'Remover Aspecto' },
      content: `<p>Remover "${node?.name ?? 'este Aspecto'}"? Esta ação não pode ser desfeita.</p>`,
    });
    if (!confirmed) {
      return;
    }

    await this.#service.removeNode(this.#actorId, nodeId);
    this.#lastDefinition = await this.#service.getMasterDefinition(this.#actorId);
    if (this.#selectedNodeId === nodeId) {
      this.#selectedNodeId = null;
    }
    this.#renderCanvas();
    this.#removeModeActive = false;
    this.#canvas?.setMode('select');
    void this.render({ parts: ['toolbar', 'panel'] });
  }

  async #handleConnectionRemoveRequested(connectionId: string): Promise<void> {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: 'Remover Conexão' },
      content: '<p>Remover este caminho entre os dois Aspectos? Esta ação não pode ser desfeita.</p>',
    });
    if (!confirmed) {
      return;
    }

    await this.#service.disconnectNodes(this.#actorId, connectionId);
    this.#lastDefinition = await this.#service.getMasterDefinition(this.#actorId);
    this.#renderCanvas();
    this.#removeModeActive = false;
    this.#canvas?.setMode('select');
    void this.render({ parts: ['toolbar'] });
  }

  #toggleConnectMode(): void {
    this.#connectModeActive = !this.#connectModeActive;
    if (this.#connectModeActive) {
      this.#createModeActive = false;
      this.#removeModeActive = false;
    }
    this.#canvas?.setMode(this.#connectModeActive ? 'connect' : 'select');
    void this.render({ parts: ['toolbar'] });
  }

  #toggleCreateMode(): void {
    this.#createModeActive = !this.#createModeActive;
    if (this.#createModeActive) {
      this.#connectModeActive = false;
      this.#removeModeActive = false;
    }
    this.#canvas?.setMode(this.#createModeActive ? 'create' : 'select');
    void this.render({ parts: ['toolbar'] });
  }

  #toggleRemoveMode(): void {
    this.#removeModeActive = !this.#removeModeActive;
    if (this.#removeModeActive) {
      this.#createModeActive = false;
      this.#connectModeActive = false;
    }
    this.#canvas?.setMode(this.#removeModeActive ? 'remove' : 'select');
    void this.render({ parts: ['toolbar'] });
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    // Escape cancela qualquer modo ativo
    if (event.key === 'Escape') {
      if (this.#connectModeActive || this.#createModeActive || this.#removeModeActive) {
        event.preventDefault();
        this.#connectModeActive = false;
        this.#createModeActive = false;
        this.#removeModeActive = false;
        this.#canvas?.setMode('select');
        void this.render({ parts: ['toolbar'] });
      }
    }
  };

  async #handleGrantPoint(): Promise<void> {
    try {
      await this.#service.grantPoint(this.#actorId);
      this.#lastDefinition = await this.#service.getMasterDefinition(this.#actorId);
      ui.notifications?.info('Ponto da Apoteose concedido!');
      void this.render({ parts: ['panel'] });
    } catch (error) {
      if (error instanceof ConstellationError) {
        ui.notifications?.error(error.message);
      } else {
        throw error;
      }
    }
  }

  async #handleRevokePoint(): Promise<void> {
    try {
      await this.#service.revokePoint(this.#actorId);
      this.#lastDefinition = await this.#service.getMasterDefinition(this.#actorId);
      ui.notifications?.info('Ponto da Apoteose removido.');
      void this.render({ parts: ['panel'] });
    } catch (error) {
      if (error instanceof ConstellationError) {
        ui.notifications?.error(error.message);
      } else {
        throw error;
      }
    }
  }

  async #handleAddCategory(): Promise<void> {
    if (!this.#lastDefinition) {
      return;
    }
    const categories = [...this.#lastDefinition.categories, { id: foundry.utils.randomID(), label: 'Nova categoria' }];
    await this.#service.updateCategories(this.#actorId, categories);
    this.#lastDefinition = await this.#service.getMasterDefinition(this.#actorId);
    void this.render({ parts: ['panel'] });
  }

  async #handleRemoveCategory(categoryId: string | undefined): Promise<void> {
    if (!categoryId || !this.#lastDefinition) {
      return;
    }
    const categories = this.#lastDefinition.categories.filter((category) => category.id !== categoryId);
    await this.#service.updateCategories(this.#actorId, categories);
    this.#lastDefinition = await this.#service.getMasterDefinition(this.#actorId);
    void this.render({ parts: ['panel'] });
  }

  async #handleAddRarity(): Promise<void> {
    if (!this.#lastDefinition) {
      return;
    }
    const rarities = [
      ...this.#lastDefinition.rarities,
      {
        id: foundry.utils.randomID(),
        label: 'Nova raridade',
        color: '#c9b6e4',
        order: this.#lastDefinition.rarities.length,
      },
    ];
    await this.#service.updateRarities(this.#actorId, rarities);
    this.#lastDefinition = await this.#service.getMasterDefinition(this.#actorId);
    void this.render({ parts: ['panel'] });
  }

  async #handleRemoveRarity(rarityId: string | undefined): Promise<void> {
    if (!rarityId || !this.#lastDefinition) {
      return;
    }
    // Toda estrela referencia uma raridade (AspectNode.rarityId não é
    // opcional) — sem pelo menos uma sobrando, o seletor de raridade do
    // formulário do Aspecto ficaria vazio e criar/editar um nó quebraria.
    if (this.#lastDefinition.rarities.length <= 1) {
      ui.notifications?.warn('É preciso manter pelo menos uma raridade.');
      return;
    }
    const rarities = this.#lastDefinition.rarities.filter((rarity) => rarity.id !== rarityId);
    await this.#service.updateRarities(this.#actorId, rarities);
    this.#lastDefinition = await this.#service.getMasterDefinition(this.#actorId);
    this.#renderCanvas(); // pode ter sido a raridade usada na cor de alguma estrela
    void this.render({ parts: ['panel'] });
  }

  /**
   * Registra manualmente uma entrada na linha do tempo da jornada (GDD,
   * seção 12) — não precisa estar ligada a um Aspecto desbloqueado
   * especificamente, o Mestre pode anotar qualquer momento marcante.
   */
  async #handleLogHistoryEntry(): Promise<void> {
    if (!this.#lastDefinition) {
      return;
    }

    const data = await foundry.applications.api.DialogV2.input({
      window: { title: 'Nova entrada na linha do tempo' },
      content: `
        <div class="form-group">
          <label>Título do capítulo</label>
          <input type="text" name="chapterTitle" placeholder="ex.: O Último Bastião" autofocus>
        </div>
        <div class="form-group">
          <label>Aspecto relacionado (opcional)</label>
          <select name="nodeId">
            <option value="">(nenhum em especial)</option>
            ${this.#lastDefinition.nodes.map((node) => `<option value="${node.id}">${node.name}</option>`).join('')}
          </select>
        </div>
      `,
      ok: { label: 'Registrar' },
    });

    if (!data) {
      return; // Cancelado
    }

    const chapterTitle = String((data as { chapterTitle?: string }).chapterTitle ?? '').trim();
    if (!chapterTitle) {
      ui.notifications?.warn('Escreva um título pro capítulo antes de registrar.');
      return;
    }

    await this.#service.addHistoryEntry(this.#actorId, {
      date: new Date().toLocaleDateString('pt-BR'),
      nodeId: String((data as { nodeId?: string }).nodeId ?? ''),
      chapterTitle,
    });
    this.#lastDefinition = await this.#service.getMasterDefinition(this.#actorId);
    ui.notifications?.info('Entrada registrada na linha do tempo!');
    void this.render({ parts: ['panel'] });
  }

  async #handleMediaPickerClick(button: HTMLButtonElement): Promise<void> {
    // Só Mestre pode usar file picker
    if (!game.user?.isGM) {
      ui.notifications?.warn('Apenas o Mestre pode adicionar mídia.');
      return;
    }

    const mediaField = button.dataset.mediaField;
    const mediaType = button.dataset.mediaType;
    if (!mediaField || !mediaType) {
      return;
    }

    // Foundry não tem tipo "file" — só existem tipos concretos ('image',
    // 'audio', etc.). Usar um tipo inválido aqui fazia o FilePicker se
    // comportar de forma imprevisível (era o bug do 🔍 "não funcionando
    // direito"). 'imagevideo' cobre imagem OU vídeo, útil pro ícone/imagem.
    const filePickerType = mediaType === 'audio' ? 'audio' : 'imagevideo';

    const isConstellationMedia = button.dataset.constellationMedia !== undefined;

    if (isConstellationMedia) {
      const picker = new (FilePicker as any)({
        type: filePickerType,
        callback: async (path: string) => {
          if (!path || path.length === 0) {
            return; // Usuário cancelou
          }
          try {
            await this.#service.updateConstellationSettings(
              this.#actorId,
              { [mediaField]: path } as Partial<Pick<ConstellationDefinition, 'background' | 'backgroundMusic'>>,
            );
            this.#lastDefinition = await this.#service.getMasterDefinition(this.#actorId);
            this.#renderCanvas();
            void this.render({ parts: ['panel'] });
            ui.notifications?.info(`${mediaType === 'audio' ? 'Áudio' : 'Imagem'} adicionado(a)!`);
          } catch (error) {
            console.error(`${MODULE_ID} | Erro ao salvar mídia da constelação:`, error);
            ui.notifications?.error('Erro ao salvar arquivo.');
          }
        },
      });
      picker.render(true);
      return;
    }

    const form = button.closest('[data-panel-form]');
    if (!(form instanceof HTMLElement)) {
      return;
    }
    const nodeId = form.dataset.nodeId;
    if (!nodeId) {
      return;
    }

    // Cria um FilePicker com callback
    const picker = new (FilePicker as any)({
      type: filePickerType,
      callback: async (path: string) => {
        if (!path || path.length === 0) {
          return; // Usuário cancelou
        }

        try {
          // Salva no nó
          await this.#service.updateNode(this.#actorId, nodeId, {
            media: {
              ...(this.#lastDefinition?.nodes.find(n => n.id === nodeId)?.media ?? {}),
              [mediaField]: path,
            },
          } as Partial<AspectNode>);

          this.#lastDefinition = await this.#service.getMasterDefinition(this.#actorId);
          void this.render({ parts: ['panel'] });
          ui.notifications?.info(`${mediaType === 'image' ? 'Imagem' : 'Áudio'} adicionado(a)!`);
        } catch (error) {
          console.error(`${MODULE_ID} | Erro ao salvar arquivo de mídia:`, error);
          ui.notifications?.error('Erro ao salvar arquivo.');
        }
      },
    });

    picker.render(true);
  }
}
