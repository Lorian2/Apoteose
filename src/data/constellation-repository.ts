import { MODULE_ID, CURRENT_SCHEMA_VERSION, DEFAULT_CATEGORIES, DEFAULT_RARITIES } from '../constants';
import { ConstellationError } from '../errors';
import type {
  ConstellationDefinition,
  PathConnection,
  PlayerConstellationState,
  PlayerVisibleNode,
} from '../types/constellation';

const FLAG_MASTER_JOURNAL_ID = 'masterJournalId';
const FLAG_MASTER_DEFINITION = 'masterDefinition';
const FLAG_PLAYER_STATE = 'playerState';

/**
 * Uma função de migração transforma o documento de UMA versão pra próxima
 * (nunca pula versões) e devolve o resultado já com `schemaVersion`
 * incrementado. `#migrate` aplica em cadeia, na ordem, até alcançar
 * `CURRENT_SCHEMA_VERSION` — adicionar uma migração nova no futuro é só
 * acrescentar uma entrada aqui, chaveada pela versão de origem; nunca é
 * preciso tocar no restante do repositório.
 */
type MigrationStep = (raw: ConstellationDefinition) => ConstellationDefinition;

const MIGRATIONS: Record<number, MigrationStep> = {
  // v1 → v2 (Banco de Dados v1.1 → mudanças desta etapa de implementação):
  // - `backgroundMusic` é opcional, então documentos antigos já funcionam
  //   sem transformação nenhuma nesse campo — só avançamos a versão.
  // - `excludedByNodeIds` de cada conexão passa a ser garantido como array
  //   (nunca `undefined`); documentos antigos podiam não ter o campo, e o
  //   resto do código hoje assume `[]` como padrão em vários lugares via
  //   `?? []` — normalizar aqui, uma vez, é mais seguro que confiar nesse
  //   fallback se espalhar (e continuar) por todo lado.
  1: (raw) => ({
    ...raw,
    schemaVersion: 2,
    connections: raw.connections.map((connection) => ({
      ...connection,
      excludedByNodeIds: connection.excludedByNodeIds ?? [],
    })),
  }),
};

/**
 * Único ponto de acesso a flags/documentos do Foundry para dados da
 * Constelação da Apoteose (Arquitetura de Software, seção 5). Nenhuma outra
 * camada do módulo deve chamar getFlag/setFlag diretamente — é isso que
 * garante que a separação Definição Mestra / Estado do Jogador (TDD, seção
 * 3.2) nunca vaza por um bug em outro lugar do código.
 */
export class ConstellationRepository {
  /** Lê a Definição Mestra, criando-a (e ao JournalEntry oculto) se ainda não existir. */
  async getMasterDefinition(actorId: string): Promise<ConstellationDefinition> {
    const actor = this.#getActorOrThrow(actorId);
    const journal = await this.#getOrCreateMasterJournal(actor);

    const raw = journal.getFlag(MODULE_ID, FLAG_MASTER_DEFINITION);
    if (raw) {
      const migrated = this.#migrate(raw);
      if (migrated !== raw) {
        // Migração de verdade rodou (referência mudou) — persiste já
        // migrado, pra não repetir esse trabalho em toda leitura seguinte
        // (e pra qualquer outro código que leia a flag direto já achar a
        // versão nova, não a antiga).
        await journal.setFlag(MODULE_ID, FLAG_MASTER_DEFINITION, migrated);
      }
      return migrated;
    }

    const definition = this.#createInitialDefinition(actorId);
    await journal.setFlag(MODULE_ID, FLAG_MASTER_DEFINITION, definition);

    // Semeia a flag playerState do Ator já aqui — não só na próxima escrita
    // via saveMasterDefinition. Sem isso, um Mestre que apenas abre o Editor
    // (sem editar nada ainda) deixa a constelação "invisível" pro jogador:
    // a flag playerState nunca é criada, e a tentativa de derivá-la no client
    // do jogador esbarra na permissão None do JournalEntry oculto.
    await actor.setFlag(MODULE_ID, FLAG_PLAYER_STATE, this.#derivePlayerState(definition));
    return definition;
  }

  /**
   * Persiste a Definição Mestra e, na mesma operação, recalcula e persiste o
   * Estado do Jogador correspondente — as duas camadas nunca dessincronizam
   * porque nunca são escritas em passos separados (TDD, seção 3.2).
   */
  async saveMasterDefinition(actorId: string, definition: ConstellationDefinition): Promise<void> {
    const actor = this.#getActorOrThrow(actorId);
    const journal = await this.#getOrCreateMasterJournal(actor);

    await journal.setFlag(MODULE_ID, FLAG_MASTER_DEFINITION, definition);

    const playerState = this.#derivePlayerState(definition);
    await actor.setFlag(MODULE_ID, FLAG_PLAYER_STATE, playerState);
  }

  /** Lê o Estado do Jogador — o único documento que o cliente do jogador recebe. */
  async getPlayerState(actorId: string): Promise<PlayerConstellationState> {
    const actor = this.#getActorOrThrow(actorId);
    const raw = actor.getFlag(MODULE_ID, FLAG_PLAYER_STATE);
    if (raw) {
      if (raw.schemaVersion !== CURRENT_SCHEMA_VERSION && game.user?.isGM) {
        // playerState ficou desatualizado (ex.: Mestre nunca reabriu o
        // Editor depois de uma migração de schema) — só o Mestre consegue
        // re-derivar com segurança, porque isso passa por
        // getMasterDefinition, que por sua vez precisa ler o JournalEntry
        // oculto (permissão None pra jogadores). Um jogador com playerState
        // desatualizado recebe o documento como está — os campos novos
        // são sempre opcionais, então nada quebra, só fica um passo atrás
        // até o Mestre abrir o Editor uma vez.
        const definition = await this.getMasterDefinition(actorId);
        return this.#derivePlayerState(definition);
      }
      return raw;
    }

    // Ainda não existe estado do jogador. Só o Mestre pode inicializar a
    // constelação: o JournalEntry oculto da Definição Mestra tem ownership
    // None pra jogadores (Banco de Dados, seção 8), então nem chega a existir
    // no client do jogador — tentar ler/criar por aqui bateria de frente
    // numa permissão do próprio Foundry. Falha com um erro claro em vez
    // disso; o Mestre precisa abrir o Editor desse Ator pelo menos uma vez.
    if (!game.user?.isGM) {
      throw new ConstellationError(
        'NOT_INITIALIZED',
        `A constelação de ${actor.name} ainda não foi inicializada pelo Mestre.`,
      );
    }

    // Mestre: a primeira leitura da Definição Mestra semeia ambos os documentos.
    const definition = await this.getMasterDefinition(actorId);
    return this.#derivePlayerState(definition);
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

    const journal = await JournalEntry.create({
      name: `[Constelação da Apoteose — Mestre] ${actor.name}`,
      // Permissão None para jogadores: o servidor nunca transmite este
      // documento a quem não tem acesso — a base do "Mistério ativo"
      // (TDD, seção 3.2). GMs sempre têm acesso total, independente disto.
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    });

    if (!journal) {
      throw new Error('Falha ao criar o JournalEntry oculto da Definição Mestra.');
    }

    await actor.setFlag(MODULE_ID, FLAG_MASTER_JOURNAL_ID, journal.id);
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
      categories: [...DEFAULT_CATEGORIES],
      rarities: [...DEFAULT_RARITIES],
      history: [],
    };
  }

  /** Banco de Dados, seções 3–4: filtra nós/conexões para o subconjunto revelado. */
  #derivePlayerState(definition: ConstellationDefinition): PlayerConstellationState {
    const revealedIds = new Set(
      definition.nodes.filter((node) => node.visibility === 'revealed').map((node) => node.id),
    );

    const nodes: PlayerVisibleNode[] = definition.nodes
      .filter((node) => revealedIds.has(node.id))
      .map((node) => ({
        id: node.id,
        name: node.name,
        subtitle: node.subtitle,
        description: node.description,
        quote: node.quote,
        media: node.media,
        color: node.color,
        categoryId: node.categoryId,
        rarityId: node.rarityId,
        type: node.type,
        position: node.position,
        unlocked: node.unlocked,
      }));

    const connections: PathConnection[] = definition.connections.filter(
      (connection) => revealedIds.has(connection.fromNodeId) && revealedIds.has(connection.toNodeId),
    );

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
      history: definition.history,
    };
  }

  /**
   * Aplica migrações em cadeia até `CURRENT_SCHEMA_VERSION` (Banco de
   * Dados, seção 9). Devolve a MESMA referência recebida (`raw`) quando
   * nada precisa mudar — é assim que `getMasterDefinition` sabe se vale a
   * pena persistir o resultado de volta ou não.
   */
  #migrate(raw: ConstellationDefinition): ConstellationDefinition {
    let current = raw;

    while (current.schemaVersion < CURRENT_SCHEMA_VERSION) {
      const step = MIGRATIONS[current.schemaVersion];
      if (!step) {
        throw new ConstellationError(
          'SCHEMA_MIGRATION_FAILED',
          `Não há migração definida de v${current.schemaVersion} para v${current.schemaVersion + 1} ` +
            `(meta: v${CURRENT_SCHEMA_VERSION}). Alguma migração ficou faltando ser escrita.`,
        );
      }
      current = step(current);
    }

    if (current.schemaVersion > CURRENT_SCHEMA_VERSION) {
      // Documento foi salvo por uma versão do módulo mais nova que a
      // instalada agora — nunca faz sentido "desmigrar". Falha alto e claro
      // em vez de tentar ler campos que talvez nem existam nesta versão.
      throw new ConstellationError(
        'SCHEMA_MIGRATION_FAILED',
        `Esta constelação foi salva por uma versão mais nova do módulo (v${current.schemaVersion}) do que a ` +
          `instalada (v${CURRENT_SCHEMA_VERSION}). Atualize o módulo Constelação da Apoteose.`,
      );
    }

    return current;
  }
}
