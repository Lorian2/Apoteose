import { MODULE_ID } from '../constants';
import { setAllCanvasesAnimated } from '../rendering/nebula-canvas';

const ANIMATED_SKY_KEY = 'animatedSky';

/**
 * "Céu animado" (por client): cintilação, estrelas cadentes, poeira à
 * deriva e luz fluindo nos caminhos. Desligar ajuda em máquinas fracas e
 * para quem prefere menos movimento. Começa desligado se o sistema pedir
 * movimento reduzido.
 */
export function registerDisplaySettings(): void {
  game.settings?.register(MODULE_ID, ANIMATED_SKY_KEY, {
    name: 'Céu animado',
    hint: 'Estrelas que cintilam, estrelas cadentes, poeira à deriva e luz fluindo nos caminhos. Desligue em máquinas mais fracas.',
    scope: 'client',
    config: true,
    type: Boolean,
    default: !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    onChange: (value: unknown) => setAllCanvasesAnimated(!!value),
  });
}

export function isSkyAnimated(): boolean {
  return readSetting(ANIMATED_SKY_KEY, true);
}

/**
 * Lê uma configuração do módulo sem lançar erro: se ela não estiver
 * registrada (init interrompido por outra falha), usa o padrão. Uma
 * preferência de exibição nunca pode impedir a janela de abrir.
 */
export function readSetting<T>(key: string, fallback: T): T {
  try {
    return ((game.settings?.get as (scope: string, key: string) => unknown)?.call(game.settings, MODULE_ID, key) as T | undefined) ?? fallback;
  } catch {
    return fallback;
  }
}