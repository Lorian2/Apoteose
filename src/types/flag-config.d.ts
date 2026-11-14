import type { ConstellationDefinition, PlayerConstellationState } from './constellation';
import type { ConstellationErrorCode } from '../errors';

/**
 * Registra o schema das flags do módulo junto ao foundry-vtt-types, para que
 * `actor.getFlag('constelacao-da-apoteose', ...)` e equivalentes sejam
 * checados em tempo de compilação em vez de exigir `as` em todo lugar.
 * Deve espelhar o mapeamento do documento "Banco de Dados", seção 8.
 */
declare global {
  interface FlagConfig {
    Actor: {
      'constelacao-da-apoteose': {
        playerState?: PlayerConstellationState;
        masterJournalId?: string;
        // Relé de pedido de desbloqueio jogador→Mestre (ver services/gm-relay.ts)
        unlockRequest?: {
          requestId: string;
          nodeId: string;
          userId: string;
          status: 'pending' | 'done' | 'error';
          errorCode?: ConstellationErrorCode;
          errorMessage?: string;
        };
      };
    };
    JournalEntry: {
      'constelacao-da-apoteose': {
        masterDefinition?: ConstellationDefinition;
      };
    };
  }
}
