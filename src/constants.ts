import type { Category, RarityTier } from './types/constellation';

export const MODULE_ID = 'constelacao-da-apoteose';

/** Rótulos legíveis para AspectType (GDD, seção 5), usados no painel do Editor. */
export const ASPECT_TYPE_LABELS: Record<string, string> = {
  mechanical: 'Mecânico',
  narrative: 'Narrativo',
  historical: 'Histórico',
  secret: 'Secreto',
  final: 'Final',
  legendary: 'Lendário',
  exclusive: 'Exclusivo',
};

/**
 * Versão atual do schema de dados (Banco de Dados, seção 9).
 *
 * Histórico:
 * - v1: schema original (GDD/Banco de Dados v1.1) — sem `backgroundMusic`,
 *   sem garantia de `connections[].excludedByNodeIds` sempre ser array.
 * - v2: adiciona `backgroundMusic` (opcional, sem transformação necessária)
 *   e normaliza `excludedByNodeIds` pra sempre existir como array (nunca
 *   `undefined`) — ver migração 1→2 em constellation-repository.ts.
 *
 * Ao adicionar uma mudança de schema nova: incremente este número E
 * acrescente a migração correspondente em `MIGRATIONS`
 * (constellation-repository.ts) — nunca só um dos dois.
 */
export const CURRENT_SCHEMA_VERSION = 2;

/** Raridades padrão semeadas em toda constelação nova (Banco de Dados, seção 10).
 * Paleta etérea (GDD, seção 8): raridade se expressa por luminosidade e
 * sutileza de brilho, não por cores gritantes. Sequência de tons desde
 * lavanda profunda (comum) até branco-perolado (singular).
 */
export const DEFAULT_RARITIES: RarityTier[] = [
  { id: 'common', label: 'Comum', color: '#a896c1', order: 0 },
  { id: 'uncommon', label: 'Incomum', color: '#b8a4d4', order: 1 },
  { id: 'rare', label: 'Raro', color: '#c9b6e4', order: 2 },
  { id: 'epic', label: 'Épico', color: '#d9c8f0', order: 3 },
  { id: 'legendary', label: 'Lendário', color: '#e8d9a0', order: 4 },
  { id: 'singular', label: 'Singular', color: '#f5f3ff', order: 5 },
];

/** Categorias padrão semeadas em toda constelação nova (Banco de Dados, seção 10). */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'war', label: 'Guerra' },
  { id: 'magic', label: 'Magia' },
  { id: 'divine', label: 'Divino' },
  { id: 'fate', label: 'Destino' },
  { id: 'abyss', label: 'Abismo' },
  { id: 'technology', label: 'Tecnologia' },
  { id: 'nature', label: 'Natureza' },
];
