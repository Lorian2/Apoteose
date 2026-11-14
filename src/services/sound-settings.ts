import { MODULE_ID } from '../constants';
import { BackgroundMusicPlayer } from '../rendering/background-music';
import { readSetting } from './display-settings';

const SFX_VOLUME_KEY = 'sfxVolume';
const MUSIC_VOLUME_KEY = 'musicVolume';

/**
 * Volume dos efeitos (revelar/desbloquear/selecionar) e da música de fundo
 * — configurações por client (cada pessoa ajusta o próprio volume, não é
 * uma escolha do Mestre pra todo mundo). 0 funciona como "mudo" sem
 * precisar de um toggle separado.
 */
export function registerSoundSettings(): void {
  game.settings?.register(MODULE_ID, SFX_VOLUME_KEY, {
    name: 'Volume dos efeitos sonoros',
    hint: 'Sons de revelar, desbloquear e selecionar um Aspecto. 0 = mudo.',
    scope: 'client',
    config: true,
    type: Number,
    range: { min: 0, max: 100, step: 5 },
    default: 80,
  });

  game.settings?.register(MODULE_ID, MUSIC_VOLUME_KEY, {
    name: 'Volume da música de fundo',
    hint: 'Música que toca enquanto o Editor ou o Observatório estiverem abertos. 0 = mudo.',
    scope: 'client',
    config: true,
    type: Number,
    range: { min: 0, max: 100, step: 5 },
    default: 50,
    // Atualiza qualquer música tocando agora, sem precisar fechar/reabrir a janela.
    onChange: () => BackgroundMusicPlayer.refreshAllVolumes(),
  });
}

/** Lê o volume dos efeitos configurado, já convertido pra escala 0–1 do AudioHelper. */
export function getSfxVolume(): number {
  const raw = readSetting(SFX_VOLUME_KEY, 80);
  return raw / 100;
}

/** Lê o volume da música configurado, já convertido pra escala 0–1 do AudioHelper. */
export function getMusicVolume(): number {
  const raw = readSetting(MUSIC_VOLUME_KEY, 50);
  return raw / 100;
}
