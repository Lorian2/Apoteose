import { MODULE_ID } from '../constants';
import { getMusicVolume } from '../services/sound-settings';

/**
 * Toca a música de fundo da constelação em loop enquanto o Editor ou o
 * Observatório estiverem abertos (GDD — "música de fundo enquanto estiver
 * dentro da constelação"). Uma instância por Application; cada Application
 * chama `setTrack` a cada `_prepareContext` (não faz nada se a faixa não
 * mudou) e `stop` no próprio `_onClose`.
 */
export class BackgroundMusicPlayer {
  // Todas as instâncias tocando no momento — permite `refreshVolume()`
  // atualizar o volume ao vivo quando o slider de configuração muda, sem
  // precisar fechar e reabrir a janela pra sentir a diferença.
  static #active = new Set<BackgroundMusicPlayer>();

  #sound: foundry.audio.Sound | undefined;
  #currentSrc: string | undefined;

  /** Chamado pelo onChange da configuração de volume (sound-settings.ts). */
  static refreshAllVolumes(): void {
    const volume = getMusicVolume();
    for (const player of BackgroundMusicPlayer.#active) {
      if (player.#sound) {
        player.#sound.volume = volume;
      }
    }
  }

  async setTrack(src: string | undefined): Promise<void> {
    if (src === this.#currentSrc) {
      return;
    }
    this.stop();
    this.#currentSrc = src;

    if (!src) {
      return;
    }

    try {
      // `await` funciona tanto se `play` devolver o Sound direto quanto uma
      // Promise dele (varia entre versões do Foundry) — nos dois casos o
      // valor final aqui já é o Sound pronto pra guardar e parar depois.
      this.#sound = await foundry.audio.AudioHelper.play(
        { src, volume: getMusicVolume(), loop: true, autoplay: true },
        false,
      );
      BackgroundMusicPlayer.#active.add(this);
    } catch (error) {
      console.warn(`${MODULE_ID} | Falha ao tocar música de fundo (${src}):`, error);
    }
  }

  stop(): void {
    this.#sound?.stop();
    this.#sound = undefined;
    BackgroundMusicPlayer.#active.delete(this);
  }
}
