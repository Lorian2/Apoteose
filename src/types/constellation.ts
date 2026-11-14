/**
 * Tipos de dados da Constelação da Apoteose.
 * Espelha exatamente o documento "Banco de Dados, Flags e Modelos" v1.1 —
 * qualquer mudança de schema deve ser refletida em ambos os lugares.
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
}

export interface PathConnection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  excludedByNodeIds?: string[];
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
