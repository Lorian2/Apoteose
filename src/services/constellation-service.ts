import { ConstellationRepository } from '../data/constellation-repository';
import { ConstellationError } from '../errors';
import type {
  AspectNode,
  Category,
  ConstellationDefinition,
  HistoryEntry,
  PathConnection,
  PlayerConstellationState,
  Position,
  RarityTier,
} from '../types/constellation';
import { callModuleHook } from '../utils/hooks';
import { computeBlockedNodeIds } from '../utils/exclusion';
import { computePrerequisiteLockedNodeIds } from '../utils/prerequisites';
import { HistoryService } from './history-service';
import { PermissionGate } from './permission-gate';

/**
 * Orquestra as operações centrais da constelação (Arquitetura de Software,
 * seção 4). Cada método mutável segue o mesmo formato: checar permissão,
 * ler a Definição Mestra inteira, aplicar a mudança numa cópia, persistir
 * de volta — o `ConstellationRepository` cuida de sincronizar o Estado do
 * Jogador na mesma operação (TDD, seção 3.2).
 */
export class ConstellationService {
  readonly #repository: ConstellationRepository;
  readonly #permissions: PermissionGate;
  readonly #history: HistoryService;

  constructor(
    repository: ConstellationRepository = new ConstellationRepository(),
    permissions: PermissionGate = new PermissionGate(),
    history: HistoryService = new HistoryService(),
  ) {
    this.#repository = repository;
    this.#permissions = permissions;
    this.#history = history;
  }

  // ---------------------------------------------------------------------
  // Leitura
  // ---------------------------------------------------------------------

  async getPlayerState(actorId: string): Promise<PlayerConstellationState> {
    return this.#repository.getPlayerState(actorId);
  }

  async getMasterDefinition(actorId: string): Promise<ConstellationDefinition> {
    this.#permissions.assertGM();
    return this.#repository.getMasterDefinition(actorId);
  }

  // ---------------------------------------------------------------------
  // Nó
  // ---------------------------------------------------------------------

  async createNode(
    actorId: string,
    position: Position,
    initialData?: Partial<Omit<AspectNode, 'id' | 'position'>>,
  ): Promise<AspectNode> {
    this.#permissions.assertGM();
    const definition = await this.#repository.getMasterDefinition(actorId);

    const node: AspectNode = {
      id: foundry.utils.randomID(),
      name: 'Novo Aspecto',
      media: {},
      rarityId: definition.rarities[0]?.id ?? '',
      type: 'narrative',
      visibility: 'hidden',
      unlocked: false,
      ...initialData,
      position,
    };

    definition.nodes.push(node);
    await this.#repository.saveMasterDefinition(actorId, definition);
    return node;
  }

  async updateNode(actorId: string, nodeId: string, changes: Partial<AspectNode>): Promise<AspectNode> {
    this.#permissions.assertGM();
    const definition = await this.#repository.getMasterDefinition(actorId);
    const node = this.#findNodeOrThrow(definition, nodeId);

    Object.assign(node, changes, { id: node.id });
    await this.#repository.saveMasterDefinition(actorId, definition);
    return node;
  }

  async removeNode(actorId: string, nodeId: string): Promise<void> {
    this.#permissions.assertGM();
    const definition = await this.#repository.getMasterDefinition(actorId);
    this.#findNodeOrThrow(definition, nodeId);

    definition.nodes = definition.nodes.filter((node) => node.id !== nodeId);
    definition.connections = definition.connections.filter(
      (connection) => connection.fromNodeId !== nodeId && connection.toNodeId !== nodeId,
    );

    await this.#repository.saveMasterDefinition(actorId, definition);
  }

  async moveNode(actorId: string, nodeId: string, position: Position): Promise<void> {
    this.#permissions.assertGM();
    const definition = await this.#repository.getMasterDefinition(actorId);
    const node = this.#findNodeOrThrow(definition, nodeId);

    node.position = position;
    await this.#repository.saveMasterDefinition(actorId, definition);
  }

  // ---------------------------------------------------------------------
  // Conexões
  // ---------------------------------------------------------------------

  async connectNodes(actorId: string, fromNodeId: string, toNodeId: string): Promise<PathConnection> {
    this.#permissions.assertGM();
    const definition = await this.#repository.getMasterDefinition(actorId);
    this.#findNodeOrThrow(definition, fromNodeId);
    this.#findNodeOrThrow(definition, toNodeId);

    const connection: PathConnection = {
      id: foundry.utils.randomID(),
      fromNodeId,
      toNodeId,
    };

    definition.connections.push(connection);
    await this.#repository.saveMasterDefinition(actorId, definition);
    return connection;
  }

  async disconnectNodes(actorId: string, connectionId: string): Promise<void> {
    this.#permissions.assertGM();
    const definition = await this.#repository.getMasterDefinition(actorId);
    this.#findConnectionOrThrow(definition, connectionId);

    definition.connections = definition.connections.filter((connection) => connection.id !== connectionId);
    await this.#repository.saveMasterDefinition(actorId, definition);
  }

  async setExclusion(actorId: string, connectionId: string, excludedByNodeIds: string[]): Promise<void> {
    this.#permissions.assertGM();
    const definition = await this.#repository.getMasterDefinition(actorId);
    const connection = this.#findConnectionOrThrow(definition, connectionId);

    connection.excludedByNodeIds = excludedByNodeIds;
    await this.#repository.saveMasterDefinition(actorId, definition);
  }

  // ---------------------------------------------------------------------
  // Visibilidade e progressão
  // ---------------------------------------------------------------------

  async revealNode(actorId: string, nodeId: string): Promise<void> {
    this.#permissions.assertGM();
    const definition = await this.#repository.getMasterDefinition(actorId);
    const node = this.#findNodeOrThrow(definition, nodeId);

    node.visibility = 'revealed';
    await this.#repository.saveMasterDefinition(actorId, definition);
    callModuleHook('constelacaoApoteose.nodeRevealed', actorId, nodeId);
  }

  async hideNode(actorId: string, nodeId: string): Promise<void> {
    this.#permissions.assertGM();
    const definition = await this.#repository.getMasterDefinition(actorId);
    const node = this.#findNodeOrThrow(definition, nodeId);

    node.visibility = 'hidden';
    await this.#repository.saveMasterDefinition(actorId, definition);
  }

  async grantPoint(actorId: string, amount = 1): Promise<void> {
    this.#permissions.assertGM();
    const definition = await this.#repository.getMasterDefinition(actorId);

    definition.unspentPoints += amount;
    await this.#repository.saveMasterDefinition(actorId, definition);
    callModuleHook('constelacaoApoteose.pointGranted', actorId, amount);
  }

  /**
   * Contrapartida de `grantPoint` — remove um Ponto da Apoteose concedido
   * por engano. Nunca deixa `unspentPoints` negativo: remover mais do que
   * existe apenas zera, não é um erro (ferramenta de correção do Mestre,
   * não precisa ser precisa a esse ponto).
   */
  async revokePoint(actorId: string, amount = 1): Promise<void> {
    this.#permissions.assertGM();
    const definition = await this.#repository.getMasterDefinition(actorId);

    definition.unspentPoints = Math.max(0, definition.unspentPoints - amount);
    await this.#repository.saveMasterDefinition(actorId, definition);
    callModuleHook('constelacaoApoteose.pointRevoked', actorId, amount);
  }

  /**
   * Ajustes que pertencem à constelação inteira, não a um Aspecto — imagem
   * de fundo (ladrilhada/infinita pelo canvas) e música de fundo (toca
   * enquanto o Editor ou Observatório dessa constelação estiver aberto).
   */
  async updateConstellationSettings(
    actorId: string,
    changes: Partial<Pick<ConstellationDefinition, 'background' | 'backgroundMusic'>>,
  ): Promise<void> {
    this.#permissions.assertGM();
    const definition = await this.#repository.getMasterDefinition(actorId);

    Object.assign(definition, changes);
    await this.#repository.saveMasterDefinition(actorId, definition);
  }

  async unlockNode(actorId: string, nodeId: string): Promise<void> {
    this.#permissions.assertGM();
    const definition = await this.#repository.getMasterDefinition(actorId);
    const node = this.#findNodeOrThrow(definition, nodeId);

    const blockedIds = computeBlockedNodeIds(definition.nodes, definition.connections);
    if (blockedIds.has(nodeId)) {
      throw new ConstellationError(
        'NODE_EXCLUDED',
        'Este Aspecto não pode mais ser desbloqueado — um caminho rival foi escolhido.',
      );
    }

    const prerequisiteLockedIds = computePrerequisiteLockedNodeIds(definition.nodes, definition.connections);
    if (prerequisiteLockedIds.has(nodeId)) {
      throw new ConstellationError(
        'PREREQUISITE_NOT_MET',
        'É preciso desbloquear pelo menos um Aspecto anterior conectado antes deste.',
      );
    }

    if (definition.unspentPoints <= 0) {
      throw new ConstellationError('NO_POINTS_AVAILABLE', `Não há Pontos da Apoteose disponíveis para desbloquear este Aspecto.`);
    }

    definition.unspentPoints -= 1;
    node.unlocked = true;
    await this.#repository.saveMasterDefinition(actorId, definition);
    callModuleHook('constelacaoApoteose.nodeUnlocked', actorId, nodeId);
  }

  async lockNode(actorId: string, nodeId: string): Promise<void> {
    this.#permissions.assertGM();
    const definition = await this.#repository.getMasterDefinition(actorId);
    const node = this.#findNodeOrThrow(definition, nodeId);

    if (!node.unlocked) {
      return; // nada a desfazer — mantém a operação idempotente
    }

    node.unlocked = false;
    definition.unspentPoints += 1;
    await this.#repository.saveMasterDefinition(actorId, definition);
  }

  // ---------------------------------------------------------------------
  // Categorias, raridades e histórico
  // ---------------------------------------------------------------------

  async updateCategories(actorId: string, categories: Category[]): Promise<void> {
    this.#permissions.assertGM();
    const definition = await this.#repository.getMasterDefinition(actorId);

    definition.categories = categories;
    await this.#repository.saveMasterDefinition(actorId, definition);
  }

  async updateRarities(actorId: string, rarities: RarityTier[]): Promise<void> {
    this.#permissions.assertGM();
    const definition = await this.#repository.getMasterDefinition(actorId);

    definition.rarities = rarities;
    await this.#repository.saveMasterDefinition(actorId, definition);
  }

  async addHistoryEntry(actorId: string, entry: HistoryEntry): Promise<void> {
    this.#permissions.assertGM();
    const definition = await this.#repository.getMasterDefinition(actorId);

    definition.history = this.#history.appendEntry(definition.history, entry);
    await this.#repository.saveMasterDefinition(actorId, definition);
  }

  // ---------------------------------------------------------------------
  // Auxiliares privados
  // ---------------------------------------------------------------------

  #findNodeOrThrow(definition: ConstellationDefinition, nodeId: string): AspectNode {
    const node = definition.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      throw new ConstellationError('NODE_NOT_FOUND', `Nó não encontrado: ${nodeId}`);
    }
    return node;
  }

  #findConnectionOrThrow(definition: ConstellationDefinition, connectionId: string): PathConnection {
    const connection = definition.connections.find((candidate) => candidate.id === connectionId);
    if (!connection) {
      throw new ConstellationError('CONNECTION_NOT_FOUND', `Conexão não encontrada: ${connectionId}`);
    }
    return connection;
  }
}
