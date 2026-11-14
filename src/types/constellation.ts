/**
 * Tipos de dados da Constelação da Apoteose.
 * Espelha o documento "Banco de Dados, Flags e Modelos" — qualquer mudança
 * de schema deve ser refletida em ambos os lugares (e ganhar uma migração
 * em constellation-repository.ts).
 */

export type AspectType =
  | 'mechanical'
  | 'narrative'
  | 'historical'
  | 'secret'
  | 'final'
  | 'legendary'
  | 'exclusive';

export interface RarityTier {
  id: string;
  label: string;
  color: string;
  order: number;
}

export interface Category {
  id: string;
  label: string;
  color?: string;
}

export interface MediaRefs {
  icon?: string;
  image?: string;
  background?: string;
  soundReveal?: string;
  soundUnlock?: string;
  soundSelect?: string;
}

export interface Position {
  x: number;
  y: number;
}

/**
 * Situação de um Aspecto ainda não conquistado, derivada do grafo:
 * - `unlocked`: já desbloqueado.
 * - `available`: pode receber um Ponto da Apoteose agora.
 * - `prerequisite`: falta desbloquear um Aspecto anterior (trava temporária).
 * - `excluded`: um Aspecto rival foi escolhido, ou todo caminho até ele
 *   passa por um Aspecto excluído (trava permanente).
 */
export type NodeStatus = 'unlocked' | 'available' | 'prerequisite' | 'excluded';

/** Nó dentro da Definição Mestra — nunca transmitido integralmente ao jogador. */
export interface AspectNode {
  id: string;
  name: string;
  subtitle?: string;
  description?: string;
  quote?: string;
  media: MediaRefs;
  color?: string;
  categoryId?: string;
  rarityId: string;
  type: AspectType;
  position: Position;
  requirements?: string;
  gmNotes?: string;
  visibility: 'hidden' | 'revealed';
  unlocked: boolean;
}

/** Subconjunto de AspectNode que efetivamente chega ao cliente do jogador. */
export interface PlayerVisibleNode {
  id: string;
  name: string;
  subtitle?: string;
  description?: string;
  quote?: string;
  media: MediaRefs;
  color?: string;
  categoryId?: string;
  rarityId: string;
  type: AspectType;
  position: Position;
  unlocked: boolean;
  /**
   * Calculada pelo Mestre sobre a Definição Mestra inteira (inclusive nós
   * ocultos e exclusões, que o jogador nunca recebe). Ausente em estados
   * gravados antes do schema v3.
   */
  status?: NodeStatus;
}

export interface PathConnection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  /** Schema ≤ v2 apenas — substituído por `ConstellationDefinition.exclusions`. */
  excludedByNodeIds?: string[];
}

/**
 * Exclusão mútua entre dois Aspectos: desbloquear um fecha o outro para
 * sempre, nos dois sentidos. Visível só para o Mestre.
 */
export interface ExclusionPair {
  a: string;
  b: string;
}

export interface HistoryEntry {
  date: string;
  nodeId: string;
  chapterTitle?: string;
}

/** Documento raiz da Definição Mestra (flag no JournalEntry oculto). */
export interface ConstellationDefinition {
  schemaVersion: number;
  actorId: string;
  initialNodeId: string;
  unspentPoints: number;
  nodes: AspectNode[];
  connections: PathConnection[];
  exclusions: ExclusionPair[];
  categories: Category[];
  rarities: RarityTier[];
  background?: string;
  backgroundMusic?: string;
  history: HistoryEntry[];
}

/** Documento raiz do Estado do Jogador (flag no próprio Actor). */
export interface PlayerConstellationState {
  schemaVersion: number;
  actorId: string;
  initialNodeId: string;
  unspentPoints: number;
  nodes: PlayerVisibleNode[];
  connections: PathConnection[];
  categories: Category[];
  rarities: RarityTier[];
  background?: string;
  backgroundMusic?: string;
  history: HistoryEntry[];
}
