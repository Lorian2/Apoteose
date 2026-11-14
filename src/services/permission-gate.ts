import { ConstellationError } from '../errors';

/**
 * Verificação central de permissão (Arquitetura de Software, seção 4).
 * Todo método mutável do ConstellationService passa por aqui primeiro —
 * nenhuma outra parte do módulo decide, por conta própria, se uma escrita
 * é permitida.
 */
export class PermissionGate {
  assertGM(): void {
    if (!game.user?.isGM) {
      throw new ConstellationError('NOT_GM', 'Esta operação exige permissão de Mestre.');
    }
  }
}
