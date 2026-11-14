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
  return (game.settings?.get(MODULE_ID, ANIMATED_SKY_KEY) as boolean | undefined) ?? true;
}
