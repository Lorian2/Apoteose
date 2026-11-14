import { MODULE_ID } from '../constants';
import { getSfxVolume } from '../services/sound-settings';

/**
 * Toca um som de mídia configurado num Aspecto (Banco de Dados, seção 2 —
 * MediaRefs.soundReveal/soundUnlock/soundSelect). Não faz nada se o campo
 * estiver vazio — som é sempre opcional, nunca deve travar a interação
 * por falta de arquivo configurado.
 */
export function playMediaSound(src: string | undefined | null): void {
  if (!src) {
    return;
  }
  const volume = getSfxVolume();
  if (volume <= 0) {
    return; // "Mudo" — nem vale a pena carregar o arquivo
  }
  // Foundry V13 removeu a referência global `AudioHelper` (existia até a V12) —
  // o caminho namespaced `foundry.audio.AudioHelper` é o único que existe
  // nesta versão. Usar o global antigo aqui lançava ReferenceError sempre
  // que um nó com som configurado era selecionado, o que também impedia o
  // restante da função chamadora de rodar (o painel nunca era re-renderizado
  // depois — parecia que a própria seleção da estrela tinha parado de funcionar).
  //
  // `false` no segundo parâmetro: cada client toca localmente o que já viu
  // acontecer na sua própria tela — não faz sentido replicar por socket
  // (o Mestre e o jogador já reagem cada um ao seu próprio evento local).
  //
  // Envolvido em try/catch: mídia é sempre acessório — um caminho de áudio
  // inválido ou qualquer outra falha de reprodução nunca deve interromper
  // quem chamou esta função no meio da própria lógica (seleção de nó,
  // revelar, desbloquear).
  try {
    void foundry.audio.AudioHelper.play({ src, volume, loop: false }, false);
  } catch (error) {
    console.warn(`${MODULE_ID} | Falha ao tocar som de mídia (${src}):`, error);
  }
}
