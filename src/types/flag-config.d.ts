import type { ConstellationDefinition, PlayerConstellationState } from './constellation';

/**
 * Registra o schema das flags e configurações do módulo junto ao
 * foundry-vtt-types, para `getFlag`/`settings.get` serem checados em tempo
 * de compilação. Deve espelhar o documento "Banco de Dados", seção 8.
 */
declare global {
  interface FlagConfig {
    Actor: {
      'constelacao-da-apoteose': {
        playerState?: PlayerConstellationState;
        masterJournalId?: string;
        /** Resto do relé de desbloqueio pelo jogador (≤ 0.1.0); apagado na migração. */
        unlockRequest?: unknown;
      };
    };
    JournalEntry: {
      'constelacao-da-apoteose': {
        masterDefinition?: ConstellationDefinition;
      };
    };
  }

  interface SettingConfig {
    'constelacao-da-apoteose.sfxVolume': number;
    'constelacao-da-apoteose.musicVolume': number;
    'constelacao-da-apoteose.animatedSky': boolean;
  }
}
