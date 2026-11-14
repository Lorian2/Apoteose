export type ConstellationErrorCode =
  | 'NOT_GM'
  | 'ACTOR_NOT_FOUND'
  | 'NODE_NOT_FOUND'
  | 'CONNECTION_NOT_FOUND'
  | 'NO_POINTS_AVAILABLE'
  | 'NODE_EXCLUDED'
  | 'PREREQUISITE_NOT_MET'
  | 'SCHEMA_MIGRATION_FAILED'
  | 'NOT_INITIALIZED'
  | 'INITIAL_NODE'
  | 'INVALID_CONNECTION'
  | 'INVALID_RARITIES';

/**
 * Erro padronizado do módulo (API Interna, seção 2). Toda falha de escrita
 * ou leitura previsível lança esta classe em vez de retornar null/undefined
 * silenciosamente.
 */
export class ConstellationError extends Error {
  readonly code: ConstellationErrorCode;

  constructor(code: ConstellationErrorCode, message: string) {
    super(message);
    this.name = 'ConstellationError';
    this.code = code;
  }
}
