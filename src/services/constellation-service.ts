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
import { computeNodeStatuses } from '../utils/node-status';
import { HistoryService } from './history-service';
import { PermissionGate } from './permission-gate';

/**
 * Fila de escrita por Ator, compartilhada por todas as instâncias do
 * serviço. Cada mutação lê a Definição Mestra inteira, altera e grava de
 * volta; sem a fila, duas mutações próximas (arrastar uma estrela e, logo
 * em seguida, editar um campo) leriam o mesmo documento e a segunda
 * apagaria a primeira.
 */
const writeQueues = new Map<string, Promise<unknown>>();

function enqueue<T>(actorId: string, task: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(actorId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  writeQueues.set(actorId, next);
  void next.finally(() => {
    if (writeQueues.get(actorId) === next) writeQueues.delete(actorId);
  }).catch(() => undefined);
  return next;
}

/**
 * Orquestra as operações centrais da constelação. Toda mutação passa por
 * `#mutate`: checa permissão, entra na fila do Ator, lê, aplica a mudança e
 * persiste — o repositório sincroniza o Estado do Jogador na mesma escrita.
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
    return enqueue(actorId, () => this.#repository.getMasterDefinition(actorId));
  }

  getMasterJournalId(actorId: string): string | undefined {
    return this.#repository.getMasterJournalId(actorId);
  }

  /**
   * Regrava o Estado do Jogador de toda constelação gravada num schema
   * antigo. Chamado no `ready` pelo Mestre ativo.
   */
  async migrateOutdatedPlayerStates(): Promise<number> {
    this.#permissions.assertGM();
    let count = 0;
    for (const actor of this.#repository.actorsWithConstellation()) {
      if (!this.#repository.isPlayerStateOutdated(actor) || !actor.id) continue;
      const actorId = actor.id;
      await enqueue(actorId, async () => {
        const definition = await this.#repository.getMasterDefinition(actorId);
        await this.#repository.saveMasterDefinition(actorId, definition);
      });
      count += 1;
    }
    return count;
  }

  // ---------------------------------------------------------------------
  // Nó
  // ---------------------------------------------------------------------

  async createNode(
    actorId: string,
    position: Position,
    initialData?: Partial<Omit<AspectNode, 'id' | 'position'>>,
  ): Promise<AspectNode> {
    return this.#mutate(actorId, (definition) => {
      const node: AspectNode = {
        id: foundry.utils.randomID(),
        name: 'Novo Aspecto',
        media: {},
        rarityId: definition.rarities[0]?.id ?? '',
        type: 'narrative',
        visibility: 'hidden',
        unlocked: false,
        ...initialData,
        position: roundPosition(position),
      };
      definition.nodes.push(node);
      return node;
    });
  }

  async updateNode(actorId: string, nodeId: string, changes: Partial<AspectNode>): Promise<AspectNode> {
    return this.#mutate(actorId, (definition) => {
      const node = this.#findNodeOrThrow(definition, nodeId);
      const { id: _id, unlocked: _unlocked, visibility: _visibility, ...safeChanges } = changes;
      Object.assign(node, safeChanges);
      return node;
    });
  }

  async removeNode(actorId: string, nodeId: string): Promise<void> {
    await this.#mutate(actorId, (definition) => {
      this.#findNodeOrThrow(definition, nodeId);
      if (nodeId === definition.initialNodeId) {
        throw new ConstellationError('INITIAL_NODE', 'O Aspecto inicial não pode ser removido.');
      }
      definition.nodes = definition.nodes.filter((node) => node.id !== nodeId);
      definition.connections = definition.connections.filter(
        (connection) => connection.fromNodeId !== nodeId && connection.toNodeId !== nodeId,
      );
      definition.exclusions = definition.exclusions.filter((pair) => pair.a !== nodeId && pair.b !== nodeId);
    });
  }

  async moveNode(actorId: string, nodeId: string, position: Position): Promise<void> {
    await this.#mutate(actorId, (definition) => {
      this.#findNodeOrThrow(definition, nodeId).position = roundPosition(position);
    });
  }

  // ---------------------------------------------------------------------
  // Conexões e exclusões
  // ---------------------------------------------------------------------

  async connectNodes(actorId: string, fromNodeId: string, toNodeId: string): Promise<PathConnection> {
    return this.#mutate(actorId, (definition) => {
      this.#findNodeOrThrow(definition, fromNodeId);
      this.#findNodeOrThrow(definition, toNodeId);
      if (fromNodeId === toNodeId) {
        throw new ConstellationError('INVALID_CONNECTION', 'Um Aspecto não pode levar a ele mesmo.');
      }
      const duplicate = definition.connections.find(
        (connection) =>
          (connection.fromNodeId === fromNodeId && connection.toNodeId === toNodeId) ||
          (connection.fromNodeId === toNodeId && connection.toNodeId === fromNodeId),
      );
      if (duplicate) {
        throw new ConstellationError('INVALID_CONNECTION', 'Esses dois Aspectos já estão ligados.');
      }

      const connection: PathConnection = { id: foundry.utils.randomID(), fromNodeId, toNodeId };
      definition.connections.push(connection);
      return connection;
    });
  }

  async disconnectNodes(actorId: string, connectionId: string): Promise<void> {
    await this.#mutate(actorId, (definition) => {
      this.#findConnectionOrThrow(definition, connectionId);
      definition.connections = definition.connections.filter((connection) => connection.id !== connectionId);
    });
  }

  /** Inverte o sentido de um caminho (origem ↔ destino). */
  async reverseConnection(actorId: string, connectionId: string): Promise<void> {
    await this.#mutate(actorId, (definition) => {
      const connection = this.#findConnectionOrThrow(definition, connectionId);
      [connection.fromNodeId, connection.toNodeId] = [connection.toNodeId, connection.fromNodeId];
    });
  }

  /** Liga ou desliga a exclusão mútua entre dois Aspectos (simétrica). */
  async setExclusive(actorId: string, nodeA: string, nodeB: string, exclusive: boolean): Promise<void> {
    await this.#mutate(actorId, (definition) => {
      this.#findNodeOrThrow(definition, nodeA);
      this.#findNodeOrThrow(definition, nodeB);
      if (nodeA === nodeB) return;
      const matches = (pair: { a: string; b: string }) =>
        (pair.a === nodeA && pair.b === nodeB) || (pair.a === nodeB && pair.b === nodeA);
      definition.exclusions = definition.exclusions.filter((pair) => !matches(pair));
      if (exclusive) definition.exclusions.push({ a: nodeA, b: nodeB });
    });
  }

  // ---------------------------------------------------------------------
  // Visibilidade e progressão
  // ---------------------------------------------------------------------

  async revealNode(actorId: string, nodeId: string): Promise<void> {
    await this.#mutate(actorId, (definition) => {
      this.#findNodeOrThrow(definition, nodeId).visibility = 'revealed';
    });
    callModuleHook('constelacaoApoteose.nodeRevealed', actorId, nodeId);
  }

  async hideNode(actorId: string, nodeId: string): Promise<void> {
    await this.#mutate(actorId, (definition) => {
      this.#findNodeOrThrow(definition, nodeId).visibility = 'hidden';
    });
  }

  async grantPoint(actorId: string, amount = 1): Promise<void> {
    await this.#mutate(actorId, (definition) => {
      definition.unspentPoints += amount;
    });
    callModuleHook('constelacaoApoteose.pointGranted', actorId, amount);
  }

  /** Remove Pontos concedidos por engano; nunca deixa o saldo negativo. */
  async revokePoint(actorId: string, amount = 1): Promise<void> {
    await this.#mutate(actorId, (definition) => {
      definition.unspentPoints = Math.max(0, definition.unspentPoints - amount);
    });
    callModuleHook('constelacaoApoteose.pointRevoked', actorId, amount);
  }

  async updateConstellationSettings(
    actorId: string,
    changes: Partial<Pick<ConstellationDefinition, 'background' | 'backgroundMusic'>>,
  ): Promise<void> {
    await this.#mutate(actorId, (definition) => {
      if ('background' in changes) definition.background = changes.background ?? '';
      if ('backgroundMusic' in changes) definition.backgroundMusic = changes.backgroundMusic ?? '';
    });
  }

  /**
   * Desbloqueia um Aspecto gastando um Ponto da Apoteose. Só o Mestre
   * executa (GDD §6–7); o jogador escolhe fora do módulo.
   */
  async unlockNode(actorId: string, nodeId: string): Promise<void> {
    await this.#mutate(actorId, (definition) => {
      const node = this.#findNodeOrThrow(definition, nodeId);
      const status = computeNodeStatuses(definition.nodes, definition.connections, definition.exclusions).get(nodeId);

      if (status === 'unlocked') return;
      if (status === 'excluded') {
        throw new ConstellationError(
          'NODE_EXCLUDED',
          'Este Aspecto não pode mais ser desbloqueado — um caminho rival foi escolhido.',
        );
      }
      if (status === 'prerequisite') {
        throw new ConstellationError(
          'PREREQUISITE_NOT_MET',
          'É preciso desbloquear pelo menos um Aspecto anterior conectado antes deste.',
        );
      }
      if (definition.unspentPoints <= 0) {
        throw new ConstellationError('NO_POINTS_AVAILABLE', 'Não há Pontos da Apoteose disponíveis.');
      }

      definition.unspentPoints -= 1;
      node.unlocked = true;
    });
    callModuleHook('constelacaoApoteose.nodeUnlocked', actorId, nodeId);
  }

  /** Desfaz um desbloqueio e devolve o Ponto. */
  async lockNode(actorId: string, nodeId: string): Promise<void> {
    await this.#mutate(actorId, (definition) => {
      const node = this.#findNodeOrThrow(definition, nodeId);
      if (!node.unlocked) return;
      if (nodeId === definition.initialNodeId) {
        throw new ConstellationError('INITIAL_NODE', 'O Aspecto inicial está sempre desbloqueado.');
      }
      node.unlocked = false;
      definition.unspentPoints += 1;
    });
  }

  // ---------------------------------------------------------------------
  // Categorias, raridades, histórico e desfazer
  // ---------------------------------------------------------------------

  async updateCategories(actorId: string, categories: Category[]): Promise<void> {
    await this.#mutate(actorId, (definition) => {
      definition.categories = categories;
    });
  }

  async updateRarities(actorId: string, rarities: RarityTier[]): Promise<void> {
    if (!rarities.length) {
      throw new ConstellationError('INVALID_RARITIES', 'É preciso manter pelo menos uma raridade.');
    }
    await this.#mutate(actorId, (definition) => {
      definition.rarities = rarities;
      const fallback = rarities[0].id;
      const valid = new Set(rarities.map((rarity) => rarity.id));
      for (const node of definition.nodes) {
        if (!valid.has(node.rarityId)) node.rarityId = fallback;
      }
    });
  }

  async addHistoryEntry(actorId: string, entry: HistoryEntry): Promise<void> {
    await this.#mutate(actorId, (definition) => {
      definition.history = this.#history.appendEntry(definition.history, entry);
    });
  }

  async removeHistoryEntry(actorId: string, index: number): Promise<void> {
    await this.#mutate(actorId, (definition) => {
      definition.history = definition.history.filter((_entry, position) => position !== index);
    });
  }

  /**
   * Substitui a Definição Mestra por uma cópia anterior (Desfazer/Refazer
   * do Editor). Mantém `actorId` e a versão do schema atuais.
   */
  async restoreDefinition(actorId: string, snapshot: ConstellationDefinition): Promise<void> {
    await this.#mutate(actorId, (definition) => {
      const restored = foundry.utils.deepClone(snapshot);
      Object.assign(definition, restored, { actorId: definition.actorId, schemaVersion: definition.schemaVersion });
    });
  }

  // ---------------------------------------------------------------------
  // Auxiliares privados
  // ---------------------------------------------------------------------

  async #mutate<T>(actorId: string, change: (definition: ConstellationDefinition) => T): Promise<T> {
    this.#permissions.assertGM();
    return enqueue(actorId, async () => {
      const definition = await this.#repository.getMasterDefinition(actorId);
      const result = change(definition);
      await this.#repository.saveMasterDefinition(actorId, definition);
      return result;
    });
  }

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

function roundPosition(position: Position): Position {
  return { x: Math.round(position.x), y: Math.round(position.y) };
}
