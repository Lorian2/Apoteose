import { MODULE_ID, CURRENT_SCHEMA_VERSION, DEFAULT_CATEGORIES, DEFAULT_RARITIES } from '../constants';
import { ConstellationError } from '../errors';
import type {
  ConstellationDefinition,
  ExclusionPair,
  PathConnection,
  PlayerConstellationState,
  PlayerVisibleNode,
} from '../types/constellation';
import { computeNodeStatuses } from '../utils/node-status';

const FLAG_MASTER_JOURNAL_ID = 'masterJournalId';
const FLAG_MASTER_DEFINITION = 'masterDefinition';
const FLAG_PLAYER_STATE = 'playerState';
/** Resto do relé de desbloqueio pelo jogador (removido na 0.2.0). */
const FLAG_LEGACY_UNLOCK_REQUEST = 'unlockRequest';

/**
 * Uma função de migração transforma o documento de UMA versão pra próxima
 * (nunca pula versões) e devolve o resultado já com `schemaVersion`
 * incrementado. `migrateDefinition` aplica em cadeia até alcançar
 * `CURRENT_SCHEMA_VERSION`.
 */
type MigrationStep = (raw: ConstellationDefinition) => ConstellationDefinition;

const MIGRATIONS: Record<number, MigrationStep> = {
  // v1 → v2: `backgroundMusic` opcional; `excludedByNodeIds` sempre array.
  1: (raw) => ({
    ...raw,
    schemaVersion: 2,
    connections: raw.connections.map((connection) => ({
      ...connection,
      excludedByNodeIds: connection.excludedByNodeIds ?? [],
    })),
  }),

  // v2 → v3: a exclusão deixa de morar nas conexões e vira pares de
  // Aspectos (`exclusions`), simétricos. Parte do que o painel antigo
  // mostrava como marcado (N exclui T quando TODOS os caminhos que tocam T
  // traziam N em `excludedByNodeIds`) e descarta os alvos cujas origens
  // também estão marcadas: marcar B marcava junto, sem querer, tudo que
  // vinha depois de B, e isso agora é coberto pela regra de ramo morto.
  2: (raw) => {
    const exclusions: ExclusionPair[] = [];
    const seen = new Set<string>();
    const excluders = new Set(raw.connections.flatMap((connection) => connection.excludedByNodeIds ?? []));

    for (const excluderId of excluders) {
      const targets = new Set<string>();
      for (const target of raw.nodes) {
        if (target.id === excluderId) continue;
        const touching = raw.connections.filter(
          (connection) => connection.fromNodeId === target.id || connection.toNodeId === target.id,
        );
        if (touching.length && touching.every((connection) => connection.excludedByNodeIds?.includes(excluderId))) {
          targets.add(target.id);
        }
      }

      for (const targetId of targets) {
        const origins = raw.connections
          .filter((connection) => connection.toNodeId === targetId)
          .map((connection) => connection.fromNodeId);
        if (origins.length && origins.every((originId) => targets.has(originId))) continue;

        const key = [excluderId, targetId].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        exclusions.push({ a: excluderId, b: targetId });
      }
    }

    return {
      ...raw,
      schemaVersion: 3,
      exclusions,
      connections: raw.connections.map(({ id, fromNodeId, toNodeId }) => ({ id, fromNodeId, toNodeId })),
    };
  },
};

/** Exportada para os testes. Devolve a MESMA referência quando nada muda. */
export function migrateDefinition(raw: ConstellationDefinition): ConstellationDefinition {
  let current = raw;

  while (current.schemaVersion < CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS[current.schemaVersion];
    if (!step) {
      throw new ConstellationError(
        'SCHEMA_MIGRATION_FAILED',
        `Não há migração definida de v${current.schemaVersion} para v${current.schemaVersion + 1}.`,
      );
    }
    current = step(current);
  }

  if (current.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new ConstellationError(
      'SCHEMA_MIGRATION_FAILED',
      `Esta constelação foi salva por uma versão mais nova do módulo (v${current.schemaVersion}) do que a ` +
        `instalada (v${CURRENT_SCHEMA_VERSION}). Atualize o módulo Constelação da Apoteose.`,
    );
  }

  return current;
}

/** Banco de Dados, seções 3–4: o que o jogador pode receber. Exportada para os testes. */
export function derivePlayerState(definition: ConstellationDefinition): PlayerConstellationState {
  const statuses = computeNodeStatuses(definition.nodes, definition.connections, definition.exclusions);
  const revealed = definition.nodes.filter((node) => node.visibility === 'revealed');
  const revealedIds = new Set(revealed.map((node) => node.id));

  const nodes: PlayerVisibleNode[] = revealed.map((node) => ({
    id: node.id,
    name: node.name,
    subtitle: node.subtitle,
    description: node.description,
    quote: node.quote,
    media: {
      icon: node.media?.icon,
      image: node.media?.image,
      soundReveal: node.media?.soundReveal,
      soundUnlock: node.media?.soundUnlock,
      soundSelect: node.media?.soundSelect,
    },
    color: node.color,
    categoryId: node.categoryId,
    rarityId: node.rarityId,
    type: node.type,
    position: node.position,
    unlocked: node.unlocked,
    status: statuses.get(node.id) ?? 'available',
  }));

  const connections: PathConnection[] = definition.connections
    .filter((connection) => revealedIds.has(connection.fromNodeId) && revealedIds.has(connection.toNodeId))
    .map(({ id, fromNodeId, toNodeId }) => ({ id, fromNodeId, toNodeId }));

  return {
    schemaVersion: definition.schemaVersion,
    actorId: definition.actorId,
    initialNodeId: definition.initialNodeId,
    unspentPoints: definition.unspentPoints,
    nodes,
    connections,
    categories: definition.categories,
    rarities: definition.rarities,
    background: definition.background,
    backgroundMusic: definition.backgroundMusic,
    // Entradas ligadas a Aspectos ainda ocultos não entregam o nome deles.
    history: definition.history.map((entry) =>
      entry.nodeId && !revealedIds.has(entry.nodeId) ? { ...entry, nodeId: '' } : entry,
    ),
  };
}

/**
 * Único ponto de acesso a flags/documentos do Foundry para dados da
 * Constelação da Apoteose. Nenhuma outra camada chama getFlag/setFlag
 * diretamente — é isso que garante que a separação Definição Mestra /
 * Estado do Jogador nunca vaza por um bug em outro lugar do código.
 */
export class ConstellationRepository {
  /** Lê a Definição Mestra, criando-a (e ao JournalEntry oculto) se ainda não existir. */
  async getMasterDefinition(actorId: string): Promise<ConstellationDefinition> {
    const actor = this.#getActorOrThrow(actorId);
    const journal = await this.#getOrCreateMasterJournal(actor);

    const raw = journal.getFlag(MODULE_ID, FLAG_MASTER_DEFINITION);

    // Ator duplicado: a cópia herda as flags do original e passaria a dividir
    // o mesmo diário. Ela ganha uma constelação própria, copiada da original.
    if (raw?.actorId && raw.actorId !== actorId) {
      const copy = { ...foundry.utils.deepClone(migrateDefinition(raw)), actorId };
      const target = game.actors?.get(raw.actorId) ? await this.#createMasterJournal(actor) : journal;
      await this.#write(actor, target, copy);
      return foundry.utils.deepClone(copy);
    }

    if (raw) {
      const migrated = migrateDefinition(raw);
      if (migrated !== raw) {
        await this.#write(actor, journal, migrated);
        if (actor.getFlag(MODULE_ID, FLAG_LEGACY_UNLOCK_REQUEST)) {
          await actor.unsetFlag(MODULE_ID, FLAG_LEGACY_UNLOCK_REQUEST);
        }
      }
      return foundry.utils.deepClone(migrated);
    }

    // Semeia também o playerState: sem isso, um Mestre que só abre o Editor
    // deixaria a constelação "invisível" para o jogador.
    const definition = this.#createInitialDefinition(actorId);
    await this.#write(actor, journal, definition);
    return foundry.utils.deepClone(definition);
  }

  /** Persiste a Definição Mestra e, na mesma operação, o Estado do Jogador derivado dela. */
  async saveMasterDefinition(actorId: string, definition: ConstellationDefinition): Promise<void> {
    const actor = this.#getActorOrThrow(actorId);
    const journal = await this.#getOrCreateMasterJournal(actor);
    await this.#write(actor, journal, definition);
  }

  /** Lê o Estado do Jogador — o único documento que o cliente do jogador recebe. */
  async getPlayerState(actorId: string): Promise<PlayerConstellationState> {
    const actor = this.#getActorOrThrow(actorId);
    const raw = actor.getFlag(MODULE_ID, FLAG_PLAYER_STATE);
    if (raw) {
      if (raw.schemaVersion !== CURRENT_SCHEMA_VERSION && game.user?.isGM) {
        return derivePlayerState(await this.getMasterDefinition(actorId));
      }
      return foundry.utils.deepClone(raw);
    }

    if (!game.user?.isGM) {
      throw new ConstellationError(
        'NOT_INITIALIZED',
        `A constelação de ${actor.name} ainda não foi inicializada pelo Mestre.`,
      );
    }
    return derivePlayerState(await this.getMasterDefinition(actorId));
  }

  /** ID do JournalEntry oculto (para o Editor reagir a mudanças feitas por outro Mestre). */
  getMasterJournalId(actorId: string): string | undefined {
    return game.actors?.get(actorId)?.getFlag(MODULE_ID, FLAG_MASTER_JOURNAL_ID);
  }

  /** Atores que já têm constelação (usado pela migração no `ready`). */
  actorsWithConstellation(): Actor[] {
    return (game.actors?.contents ?? []).filter((actor) => !!actor.getFlag(MODULE_ID, FLAG_MASTER_JOURNAL_ID));
  }

  /** O Estado do Jogador gravado está numa versão anterior do schema? */
  isPlayerStateOutdated(actor: Actor): boolean {
    const state = actor.getFlag(MODULE_ID, FLAG_PLAYER_STATE);
    return !!state && state.schemaVersion !== CURRENT_SCHEMA_VERSION;
  }

  async #write(actor: Actor, journal: JournalEntry, definition: ConstellationDefinition): Promise<void> {
    await journal.setFlag(MODULE_ID, FLAG_MASTER_DEFINITION, definition);
    await actor.setFlag(MODULE_ID, FLAG_PLAYER_STATE, derivePlayerState(definition));
  }

  #getActorOrThrow(actorId: string): Actor {
    const actor = game.actors?.get(actorId);
    if (!actor) {
      throw new ConstellationError('ACTOR_NOT_FOUND', `Ator não encontrado: ${actorId}`);
    }
    return actor;
  }

  async #getOrCreateMasterJournal(actor: Actor): Promise<JournalEntry> {
    const existingId = actor.getFlag(MODULE_ID, FLAG_MASTER_JOURNAL_ID);
    const existing = existingId ? game.journal?.get(existingId) : undefined;
    if (existing) {
      return existing;
    }
    return this.#createMasterJournal(actor);
  }

  async #createMasterJournal(actor: Actor): Promise<JournalEntry> {
    const journal = await JournalEntry.create({
      name: `[Constelação da Apoteose — Mestre] ${actor.name}`,
      // Permissão None para jogadores: o servidor nunca transmite este
      // documento a quem não tem acesso — a base do "Mistério ativo".
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    });

    if (!journal) {
      throw new Error('Falha ao criar o JournalEntry oculto da Definição Mestra.');
    }

    await actor.setFlag(MODULE_ID, FLAG_MASTER_JOURNAL_ID, journal.id!);
    return journal;
  }

  #createInitialDefinition(actorId: string): ConstellationDefinition {
    const initialNodeId = foundry.utils.randomID();

    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      actorId,
      initialNodeId,
      unspentPoints: 0,
      nodes: [
        {
          id: initialNodeId,
          name: 'Origem',
          media: {},
          rarityId: DEFAULT_RARITIES[0].id,
          type: 'narrative',
          position: { x: 0, y: 0 },
          visibility: 'revealed',
          unlocked: true,
        },
      ],
      connections: [],
      exclusions: [],
      categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })),
      rarities: DEFAULT_RARITIES.map((rarity) => ({ ...rarity })),
      history: [],
    };
  }
}
